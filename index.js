import actualClient from '@actual-app/api';
import { getConfig } from './config.js';
import { loadState, saveState } from './state.js';
import { Trading212Client } from './t212.js';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import dayjs from 'dayjs';
import fs from 'fs';

// History is walked backwards in chunks of this size.
const CHUNK_DAYS = 360;
// The export is generated asynchronously; give up eventually rather than
// spinning forever if Trading212 never produces a download link.
const MAX_DOWNLOAD_LINK_ATTEMPTS = 20;
const DOWNLOAD_LINK_RETRY_MS = 60000;

async function getCSVData(t212Client, fromDate, toDate) {
    const report = await t212Client.exportCSV(fromDate, toDate);
    if (report === null) {
        throw new Error(`Trading212 refused the export request for ${fromDate} -> ${toDate}.`);
    }
    const reportId = report.reportId;
    console.log(`Export report created with ID: ${reportId}`);

    // Wait for the report to be generated
    console.log("Waiting for the export to be ready...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    let exportData = null;
    for (let attempt = 1; !exportData || !exportData.downloadLink; attempt++) {
        const exportList = await t212Client.getExports();
        exportData = exportList.find(e => e.reportId === Number(reportId));

        if (!exportData || !exportData.downloadLink) {
            if (attempt >= MAX_DOWNLOAD_LINK_ATTEMPTS) {
                throw new Error(`Export ${reportId} had no download link after ${attempt} attempts.`);
            }
            console.warn(`No download link found for the export. Retrying in 60 seconds (${attempt}/${MAX_DOWNLOAD_LINK_ATTEMPTS})...`);
            await new Promise(resolve => setTimeout(resolve, DOWNLOAD_LINK_RETRY_MS));
        }
    }

    console.log("Downloading export data...");
    const response = await axios.get(exportData.downloadLink);
    console.log("Export data downloaded successfully.");

    return parse(response.data, {
        columns: true,
    });
}

function parseCSVData(csvData, accountId) {
    if (!accountId) {
        throw new Error("accountId is required for parsing CSV data");
    }
    console.log("Parsing CSV data for account:", accountId);
    let transactions = [];
    let skipped = 0;
    csvData.forEach(row => {
        const account = accountId;

        // Actual stores dates as YYYY-MM-DD strings; handing it a Date object
        // or an unparseable value ends up as a literal "NaNNaNNaN" in the SQL
        // it generates, which fails deep inside reconciliation.
        const parsedDate = dayjs(row['Time']);
        const total = Number(row['Total']);
        if (!parsedDate.isValid() || !Number.isFinite(total)) {
            console.warn(`Skipping row ${row['ID'] || '<no id>'}: unusable Time "${row['Time']}" or Total "${row['Total']}".`);
            skipped++;
            return;
        }

        const date = parsedDate.format('YYYY-MM-DD');
        let amount = actualClient.utils.amountToInteger(total);
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

        const payee_name = imported_payee;

        transactions.push({
            account,
            date,
            amount,
            payee_name,
            imported_payee,
            category,
            notes,
            imported_id,
            cleared
        });
    });

    // Skipping the odd malformed row is fine; skipping all of them means the
    // export format changed under us, which must not look like a clean run.
    if (transactions.length === 0 && skipped > 0) {
        throw new Error(`All ${skipped} rows were unusable -- the export format has probably changed.`);
    }

    console.log(`CSV data parsed successfully (${transactions.length} usable rows, ${skipped} skipped).`);
    return transactions;
}

async function importChunk(csvData, config) {
    const transactions = parseCSVData(csvData, config.accountId);
    console.log(`Ready to import ${transactions.length} transactions for account: ${config.accountId}`);

    // Actual reconciles on imported_id, so re-importing a range that was
    // already synced is a no-op rather than a duplicate.
    const result = await actualClient.importTransactions(config.accountId, transactions);
    console.log(`Imported ${result.added.length} new and updated ${result.updated.length} existing transactions.`);
    for (const error of result.errors ?? []) {
        console.warn("Import warning:", error.message);
    }

    return result.added.length;
}

// Walks history backwards in CHUNK_DAYS steps until an export comes back
// empty. Each chunk is imported and checkpointed as it goes, so an interrupted
// backfill resumes from where it stopped rather than re-requesting every chunk
// from the rate-limited export API.
async function runBackfill(t212Client, config, state) {
    if (!state.backfillCursor) {
        state.backfillStart = dayjs().toISOString();
        state.backfillCursor = state.backfillStart;
        saveState(config.dataDir, state);
    }

    let toDate = dayjs(state.backfillCursor);
    let total = 0;

    while (true) {
        const fromDate = toDate.subtract(CHUNK_DAYS, 'day');
        const fromDateISO = fromDate.toISOString();
        const toDateISO = toDate.toISOString();
        console.log(`Fetching transactions from ${fromDateISO} to ${toDateISO}...`);
        const csvData = await getCSVData(t212Client, fromDateISO, toDateISO);

        if (csvData.length === 0) {
            // Empty report means we've reached the end of history
            console.log("Reached the end of transaction history.");
            state.backfillComplete = true;
            saveState(config.dataDir, state);
            break;
        }

        total += await importChunk(csvData, config);

        // Push the chunk to the server before checkpointing, so the cursor
        // never claims progress that only exists locally. If this throws the
        // run fails and the next one retries this same chunk.
        await actualClient.sync();

        state.backfillCursor = fromDateISO;
        saveState(config.dataDir, state);

        // Move to next chunk (backwards in time)
        toDate = fromDate;
    }

    return total;
}

async function runSync() {
    console.log(`Sync started at: ${new Date().toISOString()}`);
    try {
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
            fs.mkdirSync(config.dataDir, { recursive: true });
            console.log(`Data directory created at: ${config.dataDir}`);
        }

        await actualClient.init({
            dataDir: config.dataDir,
            serverURL: config.serverURL,
            password: config.password
        });

        await actualClient.downloadBudget(config.budgetId);

        const state = loadState(config.dataDir);
        const currentSync = dayjs();

        if (!state.backfillComplete) {
            // First sync (or a previous one that was interrupted): walk the
            // full history backwards before switching to incremental syncs.
            const resuming = state.backfillCursor !== null;
            console.log(resuming
                ? `Resuming backfill from ${state.backfillCursor}...`
                : "No previous sync found, backfilling full history...");
            const imported = await runBackfill(t212Client, config, state);
            console.log(`Backfill added ${imported} transactions.`);

            // A backfill can span several runs, so resume incremental syncing
            // from when it started rather than from now -- otherwise anything
            // that happened while it was running would be skipped.
            state.lastSync = state.backfillStart;
        } else {
            // Subsequent syncs: download since the last successful sync only.
            const fromDate = dayjs(state.lastSync);
            console.log(`Downloading transactions from ${fromDate.toISOString()} to ${currentSync.toISOString()}...`);
            const csvData = await getCSVData(t212Client, fromDate.toISOString(), currentSync.toISOString());
            await importChunk(csvData, config);
            state.lastSync = currentSync.toISOString();
        }

        // Only advanced once everything above succeeded; a failed run leaves
        // lastSync untouched so the next one re-covers the same window.
        saveState(config.dataDir, state);

        console.log(`Sync completed successfully at: ${new Date().toISOString()}`);
        return true;
    } catch (error) {
        console.error("Error during sync:", error);
        return false;
    } finally {
        // Always close the local budget cleanly, otherwise a failed run can
        // leave the cache in the data volume locked for the next one.
        try {
            await actualClient.shutdown();
        } catch {
            // Nothing was open -- init() itself may have been what failed.
        }
    }
}

const ok = await runSync();
process.exit(ok ? 0 : 1);
