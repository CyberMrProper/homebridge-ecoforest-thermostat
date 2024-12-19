"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcoforestThermostatPlatform = void 0;
const platformAccessory_js_1 = require("./platformAccessory.js");
const PLATFORM_NAME = 'EcoforestThermostatPlatform';
const PLUGIN_NAME = 'homebridge-ecoforest-thermostat';
exports.default = (api) => {
    api.registerPlatform(PLATFORM_NAME, EcoforestThermostatPlatform);
};
class EcoforestThermostatPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = new Map();
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.log.debug('Finished initializing platform:', this.config.name);
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Executed didFinishLaunching callback');
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.set(accessory.UUID, accessory);
    }
    discoverDevices() {
        const discoveredCacheUUIDs = new Set();
        for (const device of this.config.accessories) {
            const uuid = this.api.hap.uuid.generate(device.name);
            discoveredCacheUUIDs.add(uuid);
            const existingAccessory = this.accessories.get(uuid);
            if (existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                new platformAccessory_js_1.EcoforestThermostatAccessory(this, existingAccessory, device);
            }
            else {
                this.log.info('Adding new accessory:', device.name);
                const accessory = new this.api.platformAccessory(device.name, uuid);
                accessory.context.device = device;
                new platformAccessory_js_1.EcoforestThermostatAccessory(this, accessory, device);
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }
        this.removeMissingAccessories(discoveredCacheUUIDs);
    }
    removeMissingAccessories(discoveredUUIDs) {
        for (const [uuid, accessory] of this.accessories) {
            if (!discoveredUUIDs.has(uuid)) {
                this.log.info('Removing existing accessory from cache:', accessory.displayName);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }
    }
}
exports.EcoforestThermostatPlatform = EcoforestThermostatPlatform;
//# sourceMappingURL=platform.js.map