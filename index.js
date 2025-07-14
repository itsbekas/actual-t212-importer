
import axios from "axios";
import actualClient from '@actual-app/api';
import { getConfig } from './config.js';

const t212Client = axios.create({
    baseURL: "https://live.trading212.com/api/v0",
});

async function initialize() {
    const config = getConfig();

    if (!config) {
        console.error("Configuration is not available. Please run the setup.");
        return;
    }

    actualClient.init({
        dataDir: config.dataDir,
        serverURL: config.serverURL,
        password: config.password
    });
}

await initialize();