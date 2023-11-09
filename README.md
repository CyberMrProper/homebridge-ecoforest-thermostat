# homebridge-ecoforest-heater

#### Homebridge plugin to control an Ecoforest heater device

## Installation

1. Install [homebridge](https://github.com/homebridge/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-ecoforest-heater`
3. Update your `config.json` file (See below).

## Configuration example

```json
"accessories": [
     {
       "accessory": "EcoforestHeater",
       "name": "My Heater",
       "apiroute": "https://<ecoforest_heater_ip>:8000/recepcion_datos_4.cgi",
       "username": "ecoforest_username",
       "password": "ecoforest_password",
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
| `maxTemp` _(optional)_ | Upper bound for the temperature selector in the Home app (`35` is default) |
| `minTemp` _(optional)_ | Lower bound for the temperature selector in the Home app (`12` is default) |
| `model` _(optional)_ | Appears under "Model" for your accessory in the Home app |
| `serialNumber` _(optional)_ | Appears under "Serial Number" for your accessory in the Home app |
| `manufacturer` _(optional)_ | Appears under "Manufacturer" for your accessory in the Home app |


### HeatingCoolingState Key

| Number | Name |
| --- | --- |
| `0` | Off |
| `1` | Heat |