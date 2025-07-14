import actualClient from '@actual-app/api';
import { getConfig } from './config.js';
import { Trading212Client } from './t212.js';


async function initialize() {
    const config = getConfig();

    if (!config) {
        console.error("Configuration is not available. Please run the setup.");
        return;
    }

    const t212Client = new Trading212Client(config.t212Token);

    actualClient.init({
        dataDir: config.dataDir,
        serverURL: config.serverURL,
        password: config.password
    });
}

await initialize();