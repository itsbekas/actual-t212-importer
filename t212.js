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

    async getAccountMetadata() {
        const response = await this.t212Client.get('/equity/account/info');
        return response.data;
    }

    async getExports() {
        return await this.t212Client.get('/history/exports')
            .then(response => response.data)
            .catch(async error => {
                if (error.response && error.response.status === 429) {
                    console.warn("Rate limit exceeded. Retrying after 60 seconds...");
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    return this.t212Client.get('/history/exports')
                        .then(response => response.data);
                } else {
                    console.error("Error getting exports:", error.message);
                    console.log(error.toJSON());
                    return [];
                }
            });
    }

    async exportCSV(
        fromDate,
        toDate,
        includeDividends = true,
        includeInterest = true,
        includeOrders = true,
        includeTransactions = true,
    ) {
        const params = {
            timeFrom: fromDate,
            timeTo: toDate,
            dataIncluded: {
            includeDividends,
            includeInterest,
            includeOrders,
            includeTransactions
            }
        };

        return await this.t212Client.post(
                '/history/exports',
                params,
                { headers: { 'Content-Type': 'application/json' } }
        )
            .then(response => response.data)
            .catch(async error => {
                if (error.response && error.response.status === 429) {
                    console.warn("Rate limit exceeded. Retrying after 30 seconds...");
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    return this.t212Client.post('/history/exports', params, { headers: { 'Content-Type': 'application/json' } })
                        .then(response => response.data);
                } else {
                    // this error is too noisy since it prints the whole axios response
                    console.error("Error exporting CSV:", error.message);
                    console.log(error.toJSON().data);
                    return null;
                }
            });
    }
}
