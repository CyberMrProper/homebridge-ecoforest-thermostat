import fs from 'fs/promises'; 
import axios, { AxiosRequestConfig } from 'axios';
import { Mutex } from 'async-mutex';
import * as https from 'https';
import qs from 'qs'; 
import type { CharacteristicValue, PlatformAccessory, Service, Logging } from 'homebridge';
import type { EcoforestThermostatPlatform } from './platform.js';

export class EcoforestThermostatAccessory {
  private service: Service;
  private readonly log: Logging;
  private refreshIntervalId: NodeJS.Timeout | null = null;
  private mutex = new Mutex();
  
  private readonly apiEndpoint: string;
  private readonly authUsername: string; 
  private readonly authPassword: string;
  private readonly temperatureFilePath: string;
  private readonly temperatureHotTolerance: number;
  private readonly temperatureColdTolerance: number;
  private readonly minPowerLevel: number;
  private readonly maxPowerLevel: number;
  private readonly pullInterval: string;
  private readonly maxTemp = 35;
  private readonly minTemp = 12;

  private heaterState = {
    Active: this.platform.Characteristic.Active.INACTIVE,
    CurrentHeaterCoolerState: this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
    TargetHeaterCoolerState: this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
    CurrentTemperature: 20.2,
    HeatingThresholdTemperature: 22.5,
    CurrentPower: 1
  };

  constructor(
    private readonly platform: EcoforestThermostatPlatform,
    private readonly accessory: PlatformAccessory,
    config: any,
  ) {
    this.log = platform.log;
    this.apiEndpoint = config.apiEndpoint; 
    this.authUsername = config.username; 
    this.authPassword = config.password; 
    this.temperatureFilePath = config.temperatureFilePath;
    this.temperatureHotTolerance = Number(config.temperatureHotTolerance);
    this.temperatureColdTolerance = Number(config.temperatureColdTolerance);
    this.minPowerLevel = config.minPowerLevel || 1;
    this.maxPowerLevel = config.maxPowerLevel || 9;
    this.pullInterval = config.pullInterval || 10000;

    this.accessory.on('identify', () => {
      this.log.info("Hi, I'm %s", this.accessory.displayName);
    });

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) || 
                   this.accessory.addService(this.platform.Service.HeaterCooler);

    this.initializeHeaterCoolerCharacteristics();
    this.initializaAccessoryInformationCharacteristics();
    this.refreshAccessoryStatus();
    this.startRefreshTimer();
  }

  private startRefreshTimer(): void {
    const interval = parseInt(this.pullInterval, 10);
    this.refreshIntervalId = setInterval(() => {
      this.refreshAccessoryStatus();
    }, interval);
  }

  private async refreshAccessoryStatus(): Promise<void> {
    this.log.debug("Executing RefreshAccessoryStatus");
    await this.updateStatusFromHeater(),
    await this.updateTemperatureFromFile(),
    await this.updatePowerIfNeeded()
    this.refreshCurrentHeaterCoolerState();
  }

  private initializeHeaterCoolerCharacteristics() {
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name);
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.context.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActiveState.bind(this))
      .onGet(this.getActiveState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetHeatingCoolingState.bind(this))
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [this.platform.Characteristic.TargetHeaterCoolerState.HEAT]
      });

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
      .onSet(this.setCurrentTemperature.bind(this))
      .setProps({
        minStep: 0.1
      });

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onSet(this.setHeatingThresholdTemperature.bind(this))
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      });
  }

  async setActiveState(value: CharacteristicValue) {
    if (this.heaterState.Active === value) {
      this.log.info("Heater is already in status: %s", value);
      return;
    }

    try {
      await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1013, on_off: value });
      this.heaterState.Active = Number(value);
      this.refreshCurrentHeaterCoolerState();
      this.log.info('Set Active state ->', this.heaterState.Active);
    } catch (error: any) {
      this.log.error("Error setting active state: ", error.message);
    }
  }

  async getActiveState(): Promise<CharacteristicValue> {
    const responseBody = await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1002 });
    const jsonResponse = this.parseEcoforestResponse(responseBody);
    this.heaterState.Active = this.determineHeaterActiveState(jsonResponse.estado);
    this.log.debug('Retrieved Active state ->', this.heaterState.Active);
    return this.heaterState.Active;
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    const state = this.heaterState.CurrentHeaterCoolerState;
    this.log.debug('Retrieved Current Heating Cooling State ->', state);
    return state;
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    this.heaterState.TargetHeaterCoolerState = Number(value);
    this.log.debug('Set Target Heating Cooling State ->', value);

    if (this.heaterState.Active === this.platform.Characteristic.Active.INACTIVE) {
      this.log.debug('Heater is inactive, turing it on.');
      this.setActiveState(this.platform.Characteristic.Active.ACTIVE);
      this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.heaterState.Active);
    }
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    const state = this.heaterState.TargetHeaterCoolerState;
    this.log.debug('Retrieved Target Heating Cooling State ->', state);
    return state;
  }

  async setCurrentTemperature(value: CharacteristicValue) {
        this.heaterState.CurrentTemperature = Math.round(Number(value) * 10) / 10;
        this.refreshCurrentHeaterCoolerState();
        this.log.info('Set Current Temperature ->', this.heaterState.CurrentTemperature);
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const temperature = this.heaterState.CurrentTemperature;
    this.log.debug('Retrieved Current Temperature ->', temperature);
    return temperature;
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue) {
    try {
      await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1019, temperatura: value });
      this.heaterState.HeatingThresholdTemperature = Math.round(Number(value) * 10) / 10;
      this.refreshCurrentHeaterCoolerState();
      this.log.info('Set Heating Threshold Temperature ->', value);
    } catch (error: any) {
      this.log.error("Error setting Heating Threshold Temperature: ", error.message);
    }
  }

  async getHeatingThresholdTemperature(): Promise<CharacteristicValue> {
    const temperature = this.heaterState.HeatingThresholdTemperature;
    this.log.debug('Retrieved Heating Threshold Temperature ->', temperature);
    return temperature;
  }

  private async setHeaterPower(value: number): Promise<void>  {   
    this.log.info("Changing HeaterPower to value: %s", value);

    try {
      await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1004, potencia: value});
      this.heaterState.CurrentPower = value;
      this.log.info("Successfully set HeaterPower to %s", value);
    } catch (error: any) {
      this.log.error("Error setting HeaterPower:: ", error.message);
    }
  }

  async initializaAccessoryInformationCharacteristics() {
    try {
      const responseBody = await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1020 });
      const jsonResponse = this.parseEcoforestResponse(responseBody);
      
      const accessoryInfo = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
      accessoryInfo.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Ecoforest')
        .setCharacteristic(this.platform.Characteristic.Model, jsonResponse.Me)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, Number(jsonResponse.Ns).toString())
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, jsonResponse.Vs)
        .setCharacteristic(this.platform.Characteristic.HardwareRevision, jsonResponse.Vs)
        .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);
    } catch (error: any) {
      this.log.error("Failed to update accessory information: ", error.message);
    }
  }

  private async updateStatusFromHeater(): Promise<void> {
    this.log.debug("Refreshing status from Heater");

    try {
      const responseBody = await this.makeHttpRequest('POST', this.apiEndpoint, { idOperacion: 1002 });
      const jsonResponse = this.parseEcoforestResponse(responseBody);

      var newCurrentPower = Number(jsonResponse.consigna_potencia);
      var oldCurrentPower = this.heaterState.CurrentPower;
      if (newCurrentPower != oldCurrentPower){
        this.heaterState.CurrentPower = newCurrentPower;
        this.log.info("Changing CurrentPower from %s to %s", oldCurrentPower, newCurrentPower);
      }

      var newHeatingThresholdTemperature = Number(jsonResponse.consigna_temperatura);
      var oldHeatingThresholdTemperature = this.heaterState.HeatingThresholdTemperature;
      if (newHeatingThresholdTemperature != oldHeatingThresholdTemperature){
        this.heaterState.HeatingThresholdTemperature = newHeatingThresholdTemperature;
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).updateValue(newHeatingThresholdTemperature);
        this.log.info("Changing HeatingThresholdTemperature from %s to %s", oldHeatingThresholdTemperature, newHeatingThresholdTemperature);
      }

      var newHeaterActiveStatus = this.determineHeaterActiveState(jsonResponse.estado);
      var oldHeaterActiveStatus = this.heaterState.Active;
      if (newHeaterActiveStatus != oldHeaterActiveStatus){
        this.heaterState.Active = newHeaterActiveStatus;
        this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(newHeaterActiveStatus);
        this.log.info("Changing ActiveStatus from %s to %s", oldHeaterActiveStatus, newHeaterActiveStatus);
      }

      this.refreshCurrentHeaterCoolerState();
     
    } catch (error: any) {
      this.log.error("Failed to refresh heater status: ", error.message);
    }
  }

  private async updateTemperatureFromFile(): Promise<void> {
    if (!this.temperatureFilePath) {
        return;
    }

    this.log.debug("Executing UpdateTemperatureFromFile:", this.temperatureFilePath);

    let newCurrentTemperature = 0;

    try {
        const data = await fs.readFile(this.temperatureFilePath, 'utf8');

        if (!data || data.trim().length === 0) {
            this.log.warn(`updateTemperatureFromFile error reading file: ${this.temperatureFilePath}, using previous Temperature`);
            return;
        }

        const lines = data.split(/\r?\n/);
        if (/^[0-9]+\.*[0-9]*$/.test(lines[0])) {
            newCurrentTemperature = Math.round(Number(data) * 10) / 10;
        } else {
            lines.forEach((line) => {
                if (line.includes(':')) {
                    const value = line.split(':');
                    if (value[0] === 'temperature') {
                        newCurrentTemperature = Math.round(Number(value[1]) * 10) / 10;
                    }
                }
            });
        }

        const oldCurrentTemperature = this.heaterState.CurrentTemperature;
        if (newCurrentTemperature !== oldCurrentTemperature) {
            this.heaterState.CurrentTemperature = newCurrentTemperature;
            this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.heaterState.CurrentTemperature);
            this.log.info("Changing CurrentTemperature from %s to %s", oldCurrentTemperature, newCurrentTemperature);
        }
    } catch (err: any) {
        this.log.warn(err.message);
    }
  }

  private async updatePowerIfNeeded(): Promise<void> {
    this.log.debug("Updating power if needed");

    if (this.heaterState.Active === this.platform.Characteristic.Active.ACTIVE){

      if (this.heaterState.CurrentTemperature > (this.heaterState.HeatingThresholdTemperature + this.temperatureHotTolerance)){
        if (this.heaterState.CurrentPower != this.minPowerLevel) {
          this.log.info("Room is too hot, setting power to low");
          this.setHeaterPower(this.minPowerLevel);
        }
      }

      if (this.heaterState.CurrentTemperature < (this.heaterState.HeatingThresholdTemperature - this.temperatureColdTolerance)){
        if (this.heaterState.CurrentPower != this.maxPowerLevel) {
          this.log.info("Room is too cold, setting power to high");
          this.setHeaterPower(this.maxPowerLevel);
        }
      }
    }
  }

  private async makeHttpRequest(method: 'GET' | 'POST', url: string, params: any): Promise<any> {
    const agent = new https.Agent({ rejectUnauthorized: false });

    const config: AxiosRequestConfig = {
      method,
      baseURL: url,
      httpsAgent: agent,
      data: qs.stringify(params),
      auth: {
        username: this.authUsername,
        password: this.authPassword
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text'
    };

    // The heater experiences issues when handling concurrent requests, potentially leading to wrong data
    return await this.mutex.runExclusive(async () => {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error: any) {
        this.log.error(`HTTP request failed: ${error.message}`);
        throw error;
      }
    });
  }

  private parseEcoforestResponse(output: string): any {
    const lines: string[] = output.trim().split('\n');
    const jsonObject: any = {};

    // Process all lines except the last one, as it contains irrelevant or non-useful data.
    for (let i = 0; i < lines.length - 1; i++) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine) { // Ensure line is not empty
            const [key, value] = trimmedLine.split('=');
            if (key && value !== undefined) {
              jsonObject[key.trim()] = value.trim();
            }
        }
    }

    return jsonObject;
  }

  private determineHeaterActiveState(state: string): number {
    const activeStates = ["1", "2", "3", "4", "5", "6", "7", "10", "20"];
    return activeStates.includes(String(state)) 
      ? this.platform.Characteristic.Active.ACTIVE 
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private refreshCurrentHeaterCoolerState() {
    var oldCurrentHeaterCoolerState = this.heaterState.CurrentHeaterCoolerState;
    var newCurrentHeaterCoolerState = 0;

    if (this.heaterState.Active === this.platform.Characteristic.Active.ACTIVE) {
      newCurrentHeaterCoolerState = 
        this.heaterState.CurrentTemperature <= this.heaterState.HeatingThresholdTemperature
        ? this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
        : this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    } else {
      newCurrentHeaterCoolerState = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    if (oldCurrentHeaterCoolerState != newCurrentHeaterCoolerState){
      this.heaterState.CurrentHeaterCoolerState = newCurrentHeaterCoolerState;
      this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).updateValue(this.heaterState.CurrentHeaterCoolerState);
      this.log.info("Changing CurrentHeaterCoolerState from %s to %s", oldCurrentHeaterCoolerState, newCurrentHeaterCoolerState);
    }
  }
}