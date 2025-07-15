import { createInterface } from "readline";
import fs from "fs";
import actualClient from '@actual-app/api';
import { Trading212Client } from "./t212.js";

async function tokenIsValid(token) {
    if (!token || token.length === 0) {
        console.error("Trading212 API token cannot be empty.");
        return false;
    }
    
    const t212Client = new Trading212Client(token);
    try {
        await t212Client.getAccountMetadata();
    } catch (error) {
        console.error("Invalid Trading212 API token:", error.message);
        return false;
    }

    return true;
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

function saveConfig(config) {
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

    const config = {};

    config.dataDir = await ask('Enter data directory: ');
    if (!fs.existsSync(config.dataDir)) {
        const createDir = await ask(`Directory "${config.dataDir}" does not exist. Create it? (y/n): `);
        if (createDir.trim().toLowerCase() === 'y') {
            fs.mkdirSync(config.dataDir, { recursive: true });
            console.log(`Directory "${config.dataDir}" created.`);
        } else {
            console.error("Cannot continue without a valid data directory.");
            rl.close();
            process.exit(1);
        }
    }
    config.serverURL = await ask('Enter server URL: ');
    config.password = await ask('Enter password: ');
    config.budgetID = await ask('Enter budget ID: ');

    await actualClient.init({
        dataDir: config.dataDir,
        serverURL: config.serverURL,
        password: config.password
    });

    await actualClient.downloadBudget(config.budgetID);

    const accounts = await actualClient.getAccounts();

    console.log(accounts);

    console.log(`Found ${accounts.length} accounts. Please select the account for Trading212 exports:`);
    accounts.forEach((account, index) => {
        console.log(`${index + 1}: ${account.name} (${account.id})`);
    });

    const accountIndex = await ask('Enter the number of the account: ');
    const selectedAccount = accounts[Number(accountIndex) - 1];

    config.accountId = selectedAccount.id;

    console.log(`Selected account: ${selectedAccount.name} (${selectedAccount.id})`);

    config.token = await ask('Enter Trading212 API token: ');

    while (!(await tokenIsValid(config.token))) {
        console.error("Invalid token. Please try again.");
        config.token = await ask('Enter Trading212 API token: ');
    }
    rl.close();

    saveConfig(config);
    return config;
}

export async function getConfig() {
    return configExists() ? loadConfig() : await promptConfig();
}

