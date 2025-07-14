import actualClient from '@actual-app/api';
import { getConfig } from './config.js';
import { Trading212Client } from './t212.js';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

async function getCSVData(t212Client, fromDate) {
    const export_id = await t212Client.exportCSV(fromDate)

    // The report always takes some time to be generated, so we might as well wait a bit than the full 60 seconds from the API.
    await new Promise(resolve => setTimeout(resolve, 10000));

    let exportList = await t212Client.getExports();
    let exportData = exportList.find(e => e.reportId === Number(export_id));

    if (!exportData.downloadLink) {
        console.warn("No download link found for the export. Retrying in 60 seconds...");
        await new Promise(resolve => setTimeout(resolve, 60000));
        exportList = await t212Client.getExports();
        exportData = exportList.find(e => e.id === export_id);
    }
    
    const response = await axios.get(exportData.downloadLink);

    const results = parse(response.data, {
        columns: true,
    });

    return results;
}

async function initialize() {
    const config = await getConfig();

    if (!config) {
        console.error("Configuration is not available. Please run the setup.");
        return;
    }

    const t212Client = new Trading212Client(config.token);

    // actualClient.init({
    //     dataDir: config.dataDir,
    //     serverURL: config.serverURL,
    //     password: config.password
    // });

    // TODO: get last export date from actual
    const fromDate = new Date('2025-07-01');
    await getCSVData(t212Client, fromDate)

}

await initialize();