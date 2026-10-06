// Local USB ANT+ receive bridge. No resistance/control commands are sent.
export class AntBridge {
  constructor({ loadDriver = () => import('ant-plus'), now = Date.now } = {}) {
    this.loadDriver = loadDriver;
    this.now = now;
    this.generation = 0;
    this.stick = null;
    this.timer = null;
    this.reset();
  }
  reset() {
    this.state = { status: 'disconnected', error: null, heartRate: null, power: null, cadence: null, deviceId: null,
      bikeId: 47963, heartRateDeviceId: null, updatedAt: null, heartRateUpdatedAt: null, powerUpdatedAt: null };
  }
  getStatus() {
    const result = { ...this.state };
    const now = this.now();
    if (!result.heartRateUpdatedAt || now - result.heartRateUpdatedAt > 10000) result.heartRate = null;
    if (!result.powerUpdatedAt || now - result.powerUpdatedAt > 10000) { result.power = null; result.cadence = null; }
    if (result.status === 'connected' && result.heartRate === null && result.power === null) result.status = 'scanning';
    return result;
  }
  disconnect() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    const stick = this.stick;
    this.stick = null;
    this.reset();
    try { stick?.close(); } catch { /* A removed USB device can already be closed. */ }
    return this.getStatus();
  }
  fail(message, generation) {
    if (generation !== this.generation) return;
    this.disconnect();
    this.state.status = 'error';
    this.state.error = message;
  }
  async connect({ bikeId = 47963, heartRateId = null } = {}) {
    if (['connecting', 'scanning', 'connected'].includes(this.state.status)) return this.getStatus();
    this.disconnect();
    this.state.status = 'connecting';
    this.state.bikeId = bikeId;
    this.state.heartRateDeviceId = heartRateId;
    const generation = this.generation;
    try {
      const imported = await this.loadDriver();
      if (generation !== this.generation) return this.getStatus();
      const Ant = imported.default || imported;
      const candidates = [Ant.GarminStick3, Ant.GarminStick2].filter(Boolean);
      let stick;
      for (const Stick of candidates) {
        const candidate = new Stick();
        if (candidate.is_present()) { stick = candidate; break; }
      }
      if (!stick) throw new Error('Ingen ANT+ USB-mottaker funnet. Koble til en Garmin USB2/USB-m/kompatibel ANT+-dongle. Bluetooth-mottakeren i Mac-en kan ikke motta ANT+.');
      this.stick = stick;
      const alive = () => generation === this.generation;
      stick.on('error', error => this.fail(`ANT+ USB-feil: ${String(error?.message || error)}`, generation));
      stick.on('shutdown', () => {
        if (alive()) this.fail('ANT+ USB-mottakeren ble koblet fra.', generation);
      });
      stick.once('startup', () => {
        if (!alive()) return;
        clearTimeout(this.timer);
        this.timer = null;
        this.state.status = 'scanning';
        try {
          const heart = new Ant.HeartRateScanner(stick);
          const power = new Ant.BicyclePowerScanner(stick);
          const fitness = Ant.FitnessEquipmentScanner ? new Ant.FitnessEquipmentScanner(stick) : null;
          for (const scanner of [heart, power, fitness].filter(Boolean)) scanner.on('error', error => this.fail(`ANT+ sensorfeil: ${String(error?.message || error)}`, generation));
          heart.on('hbData', data => {
            if (!alive()) return;
            if (this.state.heartRateDeviceId !== null && data.DeviceID !== this.state.heartRateDeviceId) return;
            if (!Number.isFinite(data.ComputedHeartRate) || data.ComputedHeartRate <= 0 || data.ComputedHeartRate > 254) return;
            this.state.heartRateDeviceId = data.DeviceID;
            this.state.heartRate = data.ComputedHeartRate;
            this.state.heartRateUpdatedAt = this.now();
            this.state.updatedAt = this.now();
            this.state.status = 'connected';
          });
          const receivePower = data => {
            if (!alive() || data.DeviceID !== bikeId) return;
            const watts = data.Power ?? data.CalculatedPower ?? data.InstantaneousPower;
            const cadence = data.Cadence ?? data.CalculatedCadence;
            if (!Number.isFinite(watts) || watts < 0 || watts > 5000) return;
            this.state.power = watts;
            this.state.cadence = Number.isFinite(cadence) && cadence >= 0 && cadence < 255 ? cadence : null;
            this.state.deviceId = data.DeviceID;
            this.state.powerUpdatedAt = this.now();
            this.state.updatedAt = this.now();
            this.state.status = 'connected';
          };
          power.on('powerData', receivePower);
          fitness?.on('fitnessData', receivePower);
          // The driver's scanners share the receive channel. Wait for each attach.
          heart.once('attached', () => { if (alive()) { try { power.scan(); } catch (e) { this.fail(String(e), generation); } } });
          power.once('attached', () => { if (alive() && fitness) { try { fitness.scan(); } catch (e) { this.fail(String(e), generation); } } });
          heart.scan();
        } catch (error) { this.fail(`Kunne ikke starte ANT+ skanning: ${String(error?.message || error)}`, generation); }
      });
      this.timer = setTimeout(() => this.fail('ANT+ USB svarte ikke. Lukk Garmin Express og andre programmer som bruker donglen, og prøv igjen.', generation), 8000);
      this.timer.unref?.();
      if (!stick.open()) throw new Error('Kunne ikke åpne ANT+ USB-mottakeren. Lukk Garmin Express eller andre apper som bruker den.');
    } catch (error) {
      const missing = error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND';
      this.fail(missing ? 'ANT+ USB-driveren er ikke tilgjengelig. Installer den valgfrie avhengigheten med npm install --include=optional. Native USB-støtte må fungere på denne maskinen.' : `ANT+ utilgjengelig: ${String(error?.message || error)}`, generation);
    }
    return this.getStatus();
  }
}
