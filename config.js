import { createInterface } from "readline";
import fs from "fs";

async function tokenIsValid(token) {
    if (!token || token.length === 0) {
        console.error("Trading212 API token cannot be empty.");
        return false;
    }

    const t212Client = axios.create({
        baseURL: "https://live.trading212.com/api/v0",
    });

    t212Client.defaults.headers.common['Authorization'] = token;
    return await t212Client.get('/equity/account/info')
        .then(() => true)
        .catch(() => false);
}

function loadConfig() {
    const data = fs.readFileSync('config.json', 'utf8');
    const config = JSON.parse(data);

    if (!config.dataDir || !config.serverURL || !config.password || !config.token) {
        throw new Error("Invalid configuration file. Please ensure all fields are present or delete the config file to reinitialize.");
    }

    return config;
}

function configExists() {
    return fs.existsSync('config.json');
}

function saveConfig() {
    try {
        const data = JSON.stringify(config, null, 2);
        fs.writeFileSync('config.json', data, 'utf8');
        console.log("Configuration saved successfully.");
    } catch (error) {
        console.error("Error saving configuration:", error);
    }
}

async function promptConfig() {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    config.dataDir = await ask('Enter data directory: ');
    config.serverURL = await ask('Enter server URL: ');
    config.password = await ask('Enter password: ');
    config.token = await ask('Enter Trading212 API token: ');

    while (!(await tokenIsValid(config.token))) {
        console.error("Invalid token. Please try again.");
        config.token = await ask('Enter Trading212 API token: ');
    }
    rl.close();

    saveConfig();
    return config;
}

export async function getConfig() {
    return configExists() ? loadConfig() : await promptConfig();
}
