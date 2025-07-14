import axios from "axios";

export class Trading212Client {
    constructor(token) {
        this.t212Client = axios.create({
            baseURL: "https://live.trading212.com/api/v0",
            headers: {
                'Authorization': token
            }
        });
    }

    setToken(token) {
        this.t212Client.defaults.headers.common['Authorization'] = token;
    }

    async getAccountMetadata() {
        const response = await this.t212Client.get('/equity/account/info');
        return response.data;
    }

    async getExports() {
        const response = await this.t212Client.get('/equity/export');
        return response.data;
    }

    async exportCSV(
        fromDate,
        toDate = new Date(),
        includeDividends = false,
        includeInterest = false,
        includeOrders = false,
        includeTransactions = false,
    ) {
        const params = {
            fromDate: fromDate.toISOString(),
            toDate: toDate.toISOString(),
            includeDividends,
            includeInterest,
            includeOrders,
            includeTransactions
        };
        const response = await this.t212Client.post('/history/exports', params);
        if (response.status !== 200) {
            throw new Error(`Failed to export CSV: ${response.statusText}`);
        }
        return response.data;
    }
}
