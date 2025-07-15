import actualClient from '@actual-app/api';
import { getConfig } from './config.js';
import { Trading212Client } from './t212.js';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

async function getCSVData(t212Client, fromDate) {
    const reportId = (await t212Client.exportCSV(fromDate)).reportId;
    console.log(`Export report created with ID: ${reportId}`);

    // The report always takes some time to be generated, so we might as well wait a bit than the full 60 seconds from the API.
    console.log("Waiting for the export to be ready...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    let exportList = await t212Client.getExports();
    let exportData = exportList.find(e => e.reportId === Number(reportId));

    if (!exportData.downloadLink) {
        console.warn("No download link found for the export. Retrying in 60 seconds...");
        await new Promise(resolve => setTimeout(resolve, 60000));
        exportList = await t212Client.getExports();
        exportData = exportList.find(e => e.id === export_id);
    }

    console.log("Downloading export data...");
    const response = await axios.get(exportData.downloadLink);

    const results = parse(response.data, {
        columns: true,
    });
    console.log("Export data downloaded successfully.");
    return results;
}

function parseCSVData(csvData, accountId) {
    console.log("Parsing CSV data...");
    let transactions = [];
    csvData.forEach(row => {
        const account = accountId;
        const date = new Date(row['Time']);
        let amount = actualClient.utils.amountToInteger(Number(row['Total']));
        let imported_payee = null;
        let category = row['Merchant category'] || null;
        let notes = null;
        const imported_id = row['ID'];
        const cleared = true;

        switch (row['Action']) {
            case "Deposit":
                notes = `${row['Action']} (${row['Notes']})`;
                break;
            case "Card debit":
                notes = row['Notes'] ? `${row['Merchant name']} (${row['Notes']})` : row['Merchant name'];
                imported_payee = row['Merchant name'];
                break;
            case "Card credit":
                notes = row['Notes'] ? `${row['Merchant name']} (${row['Notes']})` : row['Merchant name'];
                imported_payee = row['Merchant name'];
                break;
            case "Spending cashback":
                notes = row['Action'];
                break;
            case "Interest on cash":
                notes = row['Action'];
                break;
            case "Lending interest":
                notes = row['Notes'];
                break;
            case "Market buy":
                amount = -amount;
                notes = `${row['Action']} (${row['Ticker']})`;
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            case "Market sell":
                notes = `${row['Action']} (${row['Ticker']})`;
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            case "Dividend (Dividend)":
                notes = row['Action'];
                imported_payee = `${row['Name']} (${row['Ticker']})`;
                break;
            default:
                // do nothing
                break;
        }
        transactions.push({
            account,
            date,
            amount,
            imported_payee,
            category,
            notes,
            imported_id,
            cleared
        });
    });
    console.log("CSV data parsed successfully.");
    return transactions;
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
    const csv_data = await getCSVData(t212Client, fromDate)
    const transactions = parseCSVData(csv_data, config.accountId);
    console.log(transactions);
    // await actualClient.importTransactions(transactions);
    console.log("Transactions imported successfully.");
}

await initialize();