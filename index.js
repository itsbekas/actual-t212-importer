import actualClient from '@actual-app/api';
import { getConfig } from './config.js';
import { Trading212Client } from './t212.js';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import dayjs from 'dayjs';
import fs from 'fs';

function getFromDate(lastSync) {
    if (lastSync === null) {
        // First sync: get last 360 days of history
        return dayjs().subtract(360, 'day').toDate();
    }
    // Subsequent syncs: start from last sync date
    return new Date(lastSync);
}

async function getCSVData(t212Client, fromDate, toDate) {
    const reportId = (await t212Client.exportCSV(fromDate, toDate)).reportId;
    console.log(`Export report created with ID: ${reportId}`);

    // Wait for the report to be generated
    console.log("Waiting for the export to be ready...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    let exportData = null;
    while (!exportData || !exportData.downloadLink) {
        const exportList = await t212Client.getExports();
        exportData = exportList.find(e => e.reportId === Number(reportId));
        
        if (!exportData || !exportData.downloadLink) {
            console.warn("No download link found for the export. Retrying in 60 seconds...");
            await new Promise(resolve => setTimeout(resolve, 60000));
        }
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
    if (!accountId) {
        throw new Error("accountId is required for parsing CSV data");
    }
    console.log("Parsing CSV data for account:", accountId);
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

async function getFullHistory(t212Client, config) {
    const allTransactions = [];
    let toDate = dayjs();
    let fromDate = toDate.subtract(360, 'day');
    
    while (true) {
        const fromDateISO = fromDate.toISOString()
        const toDateISO = toDate.toISOString()
        console.log(`Fetching transactions from ${fromDateISO}...`);
        const csvData = await getCSVData(t212Client, fromDateISO, toDateISO);
        
        if (csvData.length === 0) {
            // Empty report means we've reached the end of history
            console.log("Reached the end of transaction history.");
            break;
        }
        
        // Process this batch
        const transactions = parseCSVData(csvData, config.accountId);
        allTransactions.push(...transactions);
        console.log(`Downloaded ${transactions.length} transactions.`);
        
        // Move to next 360-day chunk (backwards in time)
        toDate = fromDate;
        fromDate = fromDate.subtract(360, 'day');
    }
    
    return allTransactions;
}

async function initialize() {
    const config = await getConfig();

    if (!config) {
        console.error("Configuration is not available. Please run the setup.");
        return;
    }

    const t212Client = new Trading212Client(config.token);

    // Validate required config fields
    if (!config.accountId) {
        throw new Error("Configuration is missing accountId. Please re-run the setup.");
    }

    // Create data directory if it doesn't exist
    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir);
        console.log(`Data directory created at: ${config.dataDir}`);
    }

    await actualClient.init({
        dataDir: config.dataDir,
        serverURL: config.serverURL,
        password: config.password
    });

    await actualClient.downloadBudget(config.budgetId);

    const currentSync = dayjs();
    let transactions;
    if (config.lastSync === null) {
        // First sync: download full history in 360-day chunks
        transactions = await getFullHistory(t212Client, config);
    } else {
        // Subsequent syncs: download since last sync
        const fromDate = getFromDate(config.lastSync);
        const csv_data = await getCSVData(t212Client, fromDate);
        transactions = parseCSVData(csv_data, config.accountId);
    }
    
    console.log(`Ready to import ${transactions.length} transactions for account: ${config.accountId}`);
    await actualClient.importTransactions(config.accountId, transactions);
    console.log("Transactions imported successfully.");

    // Update lastSync timestamp in config
    config.lastSync = currentSync.toISOString();
    saveConfig(config);
}

await initialize();
