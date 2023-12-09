# homebridge-ecoforest-heater

#### Homebridge plugin to control an Ecoforest heater device as a thermostat

## Installation

1. Install [homebridge](https://github.com/homebridge/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-ecoforest-thermostat2`
3. Update your `config.json` file (See below).

## Configuration example

```json
"accessories": [
     {
       "accessory": "EcoforestThermostat",
       "name": "My Heater",
       "apiroute": "https://<ecoforest_heater_ip>:8000/recepcion_datos_4.cgi",
       "username": "ecoforest_username",
       "password": "ecoforest_password",
       "temperatureFilePath": "/home/user/temperature.txt",
       "temperatureColdTolerance": 1,
       "temperatureHotTolerance": 0,
       "minPowerLevel": 1,
       "maxPowerLevel": 9,
       "pullInterval": 60000
     }
]
```

### Structure

| Key | Description |
| --- | --- |
| `accessory` | Must be `EcoforestHeater` |
| `name` | Name to appear in the Home app |
| `apiroute` | URL of your Ecoforest heater |
| `username` | Username for HTTP authentication |
| `password` | Password for HTTP authentication |
| `pullInterval` _(optional)_ | This property expects an interval in milliseconds in which the plugin pulls updates from your Ecoforest heater (`10000` is default)  
| `temperatureFilePath` _(optional)_ | A path to a file containing a number that represents the current temperature reported to the accessory. |
| `temperatureColdTolerance` _(optional)_ | sets the allowable variance between the target and current temperatures for a heater device, triggering high-power mode when surpassed. |
| `temperatureHotTolerance` _(optional)_ | sets the allowable variance between the target and current temperatures for a heater device, triggering low-power mode when surpassed. |
| `minPowerLevel` _(optional)_ | Default low-power mode configuration  |
| `maxPowerLevel` _(optional)_ | Default high-power mode configuration  |
| `model` _(optional)_ | Appears under "Model" for your accessory in the Home app |
| `serialNumber` _(optional)_ | Appears under "Serial Number" for your accessory in the Home app |
| `manufacturer` _(optional)_ | Appears under "Manufacturer" for your accessory in the Home app |


### HeatingCoolingState Key

| Number | Name |
| --- | --- |
| `0` | Off |
| `1` | Heat |