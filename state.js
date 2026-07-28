import fs from "fs";
import path from "path";

// Sync state lives in the data directory (the only path that is a mounted
// volume when running in Docker), separate from config.json so that nothing
// here ever contains credentials.
function statePath(dataDir) {
    return path.join(dataDir, 'state.json');
}

const EMPTY_STATE = {
    // ISO timestamp of the last successful incremental sync. null until the
    // initial backfill completes.
    lastSync: null,
    // Oldest point in time the backfill has walked back to so far. Lets an
    // interrupted backfill resume instead of restarting from today.
    backfillCursor: null,
    // Newest point the backfill covers, i.e. when it first started. A backfill
    // can span several days, so this -- not the time it finished -- is where
    // incremental syncing picks up.
    backfillStart: null,
    // Set once a backfill chunk comes back empty, i.e. we reached the start
    // of the account's history.
    backfillComplete: false
};

export function loadState(dataDir) {
    const file = statePath(dataDir);

    if (!fs.existsSync(file)) {
        return { ...EMPTY_STATE };
    }

    try {
        return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
        console.warn(`Could not read ${file}, starting from a clean state:`, error.message);
        return { ...EMPTY_STATE };
    }
}

export function saveState(dataDir, state) {
    const file = statePath(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}
