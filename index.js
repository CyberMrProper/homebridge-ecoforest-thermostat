var Service, Characteristic;
var request = require("request");
const _http_base = require("homebridge-http-base");
const fs = require('fs');
const PullTimer = _http_base.PullTimer;

module.exports = function(homebridge){
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-ecoforest-thermostat2", "EcoforestThermostat", EcoforestThermostat);
};

class EcoforestThermostat {

  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.manufacturer = config.manufacturer || 'Ecoforest';
    this.model = config.model || 'Model';
    this.serialNumber = config.serialNumber || 'Serial Number';
  
    this.apiroute = config.apiroute
    this.username = config.username || null;
    this.password = config.password || null;
    this.pullInterval = config.pullInterval || 10000;
    this.timeout = config.timeout || 5000;
    this.maxTemp = config.maxTemp || 35;
    this.minTemp = config.minTemp || 12;
    this.temperatureFilePath = config.temperatureFilePath;
    this.temperatureColdTolerance = config.temperatureColdTolerance || 0.5;
    this.temperatureHotTolerance = config.temperatureHotTolerance || 0.5;
    this.minPowerLevel = config.minPowerLevel || 1;
    this.maxPowerLevel = config.maxPowerLevel || 9;
    this.currentHeaterPower = 1;
  
    if(this.username != null && this.password != null){
      this.auth = {
        user : this.username,
        pass : this.password
      };
    }
  
    this.log.info(this.name, this.apiroute);
  
    this.service = new Service.HeaterCooler(this.name);
  
    this.pullTimer = new PullTimer(this.log, this.pullInterval, this.refreshEcoforestThermostatStatus.bind(this), () => {});
    this.pullTimer.start();
  }

  identify(callback) {
    this.log.info("Hi, I'm ", this.name);
    callback();
  }

  httpRequest(url, body, callback) {
      request({
          url: url,
          body: body,
          method: "POST",
          timeout: this.timeout,
          rejectUnauthorized: false,
          auth: this.auth
      },
      function (error, response, body) {
          callback(error, response, body);
      });
  }

  parseEcoforestResponse(response){
     var responseFields = response.replace(/\n.*$/, '').replace(/"/g, '\\"').replace(/\n/g, '","').replace(/=/g,'":"')
     return JSON.parse('{"' + responseFields + '"}');
  }

  getEcoforestHeaterActiveState(estado){
    if (["1", "2", "3", "4", "5", "6", "7", "10", "20"].includes(estado))
      return Characteristic.Active.ACTIVE;
    else
      return Characteristic.Active.INACTIVE;
  }

  getEcoforestCurrentHeaterCoolerState(estado){
    if (this.getEcoforestHeaterActiveState(estado))
      return estado === "20" ? Characteristic.CurrentHeaterCoolerState.IDLE: Characteristic.CurrentHeaterCoolerState.HEATING;
    else
      return Characteristic.CurrentHeaterCoolerState.INACTIVE;
  }

  refreshEcoforestThermostatStatus() {

    this.updateTemperatureFromFile(() => {

      this.updateStatusFromHeater(() => {
        
        //Update potencia if needed
        var heaterActiveStatus = this.service.getCharacteristic(Characteristic.Active).value;
        var currentTemperature = this.service.getCharacteristic(Characteristic.CurrentTemperature).value.toFixed(1);
        var heatingThresholdTemperature = this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value.toFixed(1);

        if (heaterActiveStatus){
          if (currentTemperature > heatingThresholdTemperature + this.temperatureHotTolerance){
            if (this.currentHeaterPower != this.minPowerLevel) {
              this.log.info("Room is too hot, setting power to low");
              this.setHeaterPower(this.minPowerLevel);
            }
          }
  
          if (currentTemperature < heatingThresholdTemperature - this.temperatureColdTolerance){
            if (this.currentHeaterPower != this.maxPowerLevel) {
              this.log.info("Room is too cold, setting power to high");
              this.setHeaterPower(this.maxPowerLevel);
            }
          }
        }
        this.pullTimer.start();
      });
    });
  }

  updateTemperatureFromFile(callback){
    this.log.debug("Executing UpdateTemperatureFromFile:", this.temperatureFilePath);

    var newCurrentTemperature = this.service.getCharacteristic(Characteristic.CurrentTemperature).value;;
    fs.readFile(this.temperatureFilePath, 'utf8', (err, data) => {
      if (err) {
        this.log.warn(err.message);
        callback();
        return;
      }

      if (data === undefined || data.trim().length === 0) {
        this.log.warn(`updateTemperatureFromFile error reading file: ${this.temperatureFilePath}, using previous Temperature`);
        callback();
        return;
      }

      const lines = data.split(/\r?\n/);
      if (/^[0-9]+\.*[0-9]*$/.test(lines[0])) {
        newCurrentTemperature = parseFloat(data).toFixed(1);
      } else {
        lines.forEach((line) => {
          if (-1 < line.indexOf(':')) {
            let value = line.split(':');
            if (value[0] == 'temperature') {
              newCurrentTemperature = parseFloat(value[1]).toFixed(1);}
          }
        });
      }

      var oldCurrentTemperature = this.service.getCharacteristic(Characteristic.CurrentTemperature).value.toFixed(1);
      if (newCurrentTemperature != oldCurrentTemperature){
        this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newCurrentTemperature);
        this.log.info("Changing CurrentTemperature from %s to %s", oldCurrentTemperature, newCurrentTemperature);
      }
      callback();
    })
  }

  updateStatusFromHeater(callback){
    this.log.debug("Executing RefreshEcoforestThermostatStatus from:", this.apiroute);

    this.httpRequest(this.apiroute, 'idOperacion=1002', function (error, response, responseBody) {
      if (error) {
        this.log.warn("Error while refreshEcoforestThermostatStatus: %s - %s", error.message, responseBody);
      } else if ( response.statusCode >= 300 ) {
          this.log.warn("Error while refreshEcoforestThermostatStatus: %d - %s - %s", response.statusCode, response.statusMessage, responseBody);
      } else {
        this.log.debug("Response received from Ecoforest thermostat:\n%s", responseBody);

        var json = this.parseEcoforestResponse(responseBody);

        this.currentHeaterPower = parseFloat(json.consigna_potencia);

        var newHeatingThresholdTemperature = parseFloat(json.consigna_temperatura);
        var oldHeatingThresholdTemperature = this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).value;
        if (newHeatingThresholdTemperature != oldHeatingThresholdTemperature){
          this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(newHeatingThresholdTemperature);
          this.log.info("Changing HeatingThresholdTemperature from %s to %s", oldHeatingThresholdTemperature, newHeatingThresholdTemperature);
        }

        var newHeaterActiveStatus = this.getEcoforestHeaterActiveState(json.estado);
        var oldHeaterActiveStatus = this.service.getCharacteristic(Characteristic.Active).value;
        if (newHeaterActiveStatus != oldHeaterActiveStatus){
          this.service.getCharacteristic(Characteristic.Active).updateValue(newHeaterActiveStatus);
          this.log.info("Changing ActiveStatus from %s to %s", oldHeaterActiveStatus, newHeaterActiveStatus);
        }

        var newCurrentHeaterCoolerState = this.getEcoforestCurrentHeaterCoolerState(json.estado);
        var oldCurrentHeaterCoolerState = this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value;
        if (newCurrentHeaterCoolerState != oldCurrentHeaterCoolerState){
          this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(newCurrentHeaterCoolerState);
          this.log.info("Changing CurrentHeaterCoolerState from %s to %s", oldCurrentHeaterCoolerState, newCurrentHeaterCoolerState);
        }
      }
      callback();
    }.bind(this));
  }

  getActive(callback) {
    this.log.debug("Getting ActiveStatus from heater");

    this.httpRequest(this.apiroute, 'idOperacion=1002', function (error, response, responseBody) {
        if (error) {
          this.log.warn("Error getting ActiveStatus: %s - %s", error.message, responseBody);
          callback(error);
        } else if ( response.statusCode >= 300 ) {
            this.log.warn("Error getting ActiveStatus: %d - %s - %s", response.statusCode, response.statusMessage, responseBody);
            callback(response.statusCode);
        } else {
          this.log.debug("Response received from Ecoforest heater:\n%s", responseBody);

          var json = this.parseEcoforestResponse(responseBody);
          var heaterActiveStatus = this.getEcoforestHeaterActiveState(json.estado);
          this.log.info("Current heater ActiveStatus is: %s", heaterActiveStatus);

          callback(null, heaterActiveStatus)
        }
    }.bind(this));
  }

  setActive(value, callback) {
    var oldHeaterActiveStatus = this.service.getCharacteristic(Characteristic.Active).value;
    if (oldHeaterActiveStatus == value){
      this.log.info("Heater is already in status: %s", value);
      callback(null);
      return;
    }

    this.log.info("Changing heater ActiveStatus to: %s", value);

    this.httpRequest(this.apiroute, 'idOperacion=1013&on_off=' + value, function (error, response, responseBody) {
        if (error) {
          this.log.warn("[!] Error setting ActiveStatus: %s - %s", error.message, responseBody);
          callback(error);
        } else if ( response.statusCode >= 300 ) {
            this.log.warn("Error setting ActiveStatus: %d - %s - %s", response.statusCode, response.statusMessage, responseBody);
            callback(response.statusCode);
        } else {
          this.log.debug("Response received from Ecoforest heater:\n%s", responseBody);
          this.log.info("Heater ActiveStatus sucessfully set to: %s", value);
          this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .updateValue(value ? Characteristic.CurrentHeaterCoolerState.HEATING: Characteristic.CurrentHeaterCoolerState.INACTIVE);

          callback(null)
        }
    }.bind(this));
  }

  setHeatingThresholdTemperature(value, callback) {   
    this.log.info("[+] Changing HeatingThresholdTemperature to value: %s", value);

    this.httpRequest(this.apiroute, 'idOperacion=1019&temperatura=' + value, function (error, response, responseBody) {
        if (error) {
          this.log.warn("Error setting HeatingThresholdTemperature: %s - %s", error.message, responseBody);
          callback(error);
        } else if ( response.statusCode >= 300 ) {
            this.log.warn("Error setting HeatingThresholdTemperature: %d - %s - %s", response.statusCode, response.statusMessage, responseBody);
            callback(response.statusCode);
        } else {
          this.log.info("Sucessfully set HeatingThresholdTemperature to %s", value);
          this.log.debug("Response received from Ecoforest heater:\n%s", responseBody);
          callback(null);
        }
    }.bind(this));
  }

  setHeaterPower(value) {   
    this.log.info("[+] Changing HeaterPower to value: %s", value);

    this.httpRequest(this.apiroute, 'idOperacion=1004&potencia=' + value, function (error, response, responseBody) {
        if (error) {
          this.log.warn("Error setting HeaterPower: %s - %s", error.message, responseBody);
        } else if ( response.statusCode >= 300 ) {
            this.log.warn("Error setting HeaterPower: %d - %s - %s", response.statusCode, response.statusMessage, responseBody);
        } else {
          this.log.info("Sucessfully set HeaterPower to %s", value);
          this.log.debug("Response received from Ecoforest heater:\n%s", responseBody);
        }
    }.bind(this));
  }

  getTargetHeaterCoolerState(callback) {
    callback(null, Characteristic.TargetHeaterCoolerState.HEAT);
  }

  getName(callback) {
    callback(null, this.name);
  }

  getServices() {
    this.informationService = new Service.AccessoryInformation();
    
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

    this.service.getCharacteristic(Characteristic.Active)
      .on('get', this.getActive.bind(this))
      .on('set', this.setActive.bind(this))

    this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .updateValue(Characteristic.CurrentHeaterCoolerState.INACTIVE);

    this.service
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .on('get', this.getTargetHeaterCoolerState.bind(this));
      
    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .on('set', this.setHeatingThresholdTemperature.bind(this))

    this.service
      .getCharacteristic(Characteristic.Name)
      .on('get', this.getName.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minStep: 0.1
      });

    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      });

    //adding this characteristic so the marker for current temperature appears in the homekit wheel.
    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.minTemp,
        maxValue: this.maxTemp,
        minStep: 0.5
      })
      .updateValue(0);
 
    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
      });

    this.refreshEcoforestThermostatStatus();

    return [this.informationService, this.service];
  }
}