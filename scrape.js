const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb');
const https = require('https');

// MongoDB connection URI and database name
const uri = "mongodb+srv://admin:r3afdDqdQPnty8uc@websiteverificationsyst.auswgs2.mongodb.net/?retryWrites=true&w=majority&appName=websiteverificationsystem";
const DATABASE_NAME = 'websitescoring';

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Axios instance with timeout
const axiosInstance = axios.create({
    timeout: 10000 // 10 seconds timeout
});

// Function to create an insecure Axios instance
function createInsecureAxiosInstance() {
    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    return axios.create({
        timeout: 10000, // 10 seconds timeout
        httpsAgent: agent
    });
}

// Function to scrape links from a given URL
async function scrapeLinks(baseUrl, visited = new Set(), depth = 0, maxDepth = 1, limit = 150) {
    try {
        // Avoid revisiting the same URL
        if (visited.has(baseUrl)) {
            return [];
        }
        visited.add(baseUrl);

        const { data } = await axiosInstance.get(baseUrl);
        const $ = cheerio.load(data);
        const unwantedPatterns = ['facebook', 'twitter', 'instagram', 'linkedin', 'pinterest', 'shopify', 'blogs', 'subscriptions', 'amazon', 'tiktok', 'woocommerce'];
        const links = new Set();
        const collectionsLinks = [];

        const baseDomain = new URL(baseUrl).origin;

        $('a').each((index, element) => {
            if (links.size >= limit) return false; // Stop collecting if limit is reached

            let link = $(element).attr('href');
            if (link) {
                const fullLink = new URL(link, baseUrl).href;
                const linkDomain = new URL(fullLink).origin;

                if (!unwantedPatterns.some(pattern => link.includes(pattern)) && linkDomain === baseDomain) {
                    links.add(fullLink);
                    if (fullLink.includes('collections') || fullLink.includes('shop') || fullLink.includes('products') || fullLink.includes('product')) {
                        collectionsLinks.push(fullLink);
                    }
                }
            }
        });

        if (depth === 0 && collectionsLinks.length > 0 && links.size < limit) {
            const collectionsLink = collectionsLinks[Math.floor(Math.random() * Math.min(10, collectionsLinks.length))]; // Pick random link of (0 to 9) collections link
            const recLinks = await scrapeLinks(collectionsLink, visited, depth + 1, maxDepth, limit - links.size);
            recLinks.forEach(link => links.add(link));
        }

        return Array.from(links);
    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message.includes('socket hang up')) {
            console.error(`Timeout or socket hang up error scraping ${baseUrl}, moving on...`);
            return [baseUrl]; // Return the base URL itself in case of timeout or socket hang up error
        } else if (error.message.includes('Hostname/IP does not match certificate')) {
            console.warn(`Hostname/IP does not match certificate's altnames error for ${baseUrl}. Retrying with insecure connection...`);
            return scrapeLinksInsecure(baseUrl, visited, depth, maxDepth, limit); // Retry with insecure connection
        }
        console.error(`Error scraping ${baseUrl}:`, error.message);
        return [baseUrl]; // Return the base URL itself in case of error
    }
}

// Function to scrape links from a given URL using insecure connection
async function scrapeLinksInsecure(baseUrl, visited = new Set(), depth = 0, maxDepth = 1, limit = 150) {
    const axiosInsecureInstance = createInsecureAxiosInstance();
    try {
        if (visited.has(baseUrl)) {
            return [];
        }
        visited.add(baseUrl);

        const { data } = await axiosInsecureInstance.get(baseUrl);
        const $ = cheerio.load(data);
        const unwantedPatterns = ['facebook', 'twitter', 'instagram', 'linkedin', 'pinterest', 'shopify', 'blogs', 'subscriptions', 'amazon', 'tiktok', 'woocommerce'];
        const links = new Set();
        const collectionsLinks = [];

        const baseDomain = new URL(baseUrl).origin;

        $('a').each((index, element) => {
            if (links.size >= limit) return false;

            let link = $(element).attr('href');
            if (link) {
                const fullLink = new URL(link, baseUrl).href;
                const linkDomain = new URL(fullLink).origin;

                if (!unwantedPatterns.some(pattern => link.includes(pattern)) && linkDomain === baseDomain) {
                    links.add(fullLink);
                    if (fullLink.includes('collections') || fullLink.includes('shop') || fullLink.includes('products') || fullLink.includes('product')) {
                        collectionsLinks.push(fullLink);
                    }
                }
            }
        });

        if (depth === 0 && collectionsLinks.length > 0 && links.size < limit) {
            const collectionsLink = collectionsLinks[Math.floor(Math.random() * Math.min(10, collectionsLinks.length))];
            const recLinks = await scrapeLinksInsecure(collectionsLink, visited, depth + 1, maxDepth, limit - links.size);
            recLinks.forEach(link => links.add(link));
        }

        return Array.from(links);
    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message.includes('socket hang up')) {
            console.error(`Timeout or socket hang up error scraping ${baseUrl}, moving on...`);
            return [baseUrl];
        }
        console.error(`Error scraping ${baseUrl} with insecure connection:`, error.message);
        return [baseUrl];
    }
}

const scrapeBatch = async (urls, visited, limitPerDomain) => {
    const results = {};
    await Promise.all(urls.map(async (url) => {
        const domain = new URL(url).origin;
        console.log(`Scraping links from: ${domain}`);

        let links = [];

        try {
            const specialUrls = [`${domain}/products`, `${domain}/product`, `${domain}/collections`, `${domain}/collections-all`];
            for (const specialUrl of specialUrls) {
                try {
                    const { status } = await axiosInstance.head(specialUrl);
                    if (status === 200) {
                        links = await scrapeLinks(specialUrl, visited, 0, 1, limitPerDomain);
                        break;
                    }
                } catch (error) {
                    if (error.code !== 'ECONNABORTED' && !error.message.includes('socket hang up')) {
                        continue;
                    } else if (error.message.includes('Hostname/IP does not match certificate')) {
                        console.warn(`Hostname/IP does not match certificate's altnames error for ${specialUrl}. Retrying with insecure connection...`);
                        links = await scrapeLinksInsecure(specialUrl, visited, 0, 1, limitPerDomain);
                        if (links.length > 0) break;
                    }
                }
            }

            if (links.length === 0) {
                links = await scrapeLinks(domain, visited, 0, 1, limitPerDomain);
            }
        } catch (error) {
            console.error(`Failed to scrape ${domain}:`, error.message);
            links = [domain];
        }

        results[domain] = Array.from(new Set(links));
    }));
    return results;
};

(async () => {
    let clientConnection;
    try {
        clientConnection = await client.connect();
        const database = clientConnection.db(DATABASE_NAME);

        // Clear the output collection at the beginning
        const outputCollection = database.collection('output');
        await outputCollection.deleteMany({});
        console.log('Cleared output collection.');

        const urlsCollection = database.collection('urls');
        const urlsCursor = await urlsCollection.find();
        const urls = await urlsCursor.toArray();

        const results = {};
        const visited = new Set();
        const batchSize = 500;
        const limitPerDomain = 150;

        for (let i = 0; i < urls.length; i += batchSize) {
            const batchUrls = urls.slice(i, i + batchSize).map(doc => doc.url);
            const batchResults = await scrapeBatch(batchUrls, visited, limitPerDomain);
            Object.assign(results, batchResults);
        }

        await outputCollection.insertOne({ timestamp: new Date(), results });

        console.log(`Results written to the output collection in MongoDB`);
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (clientConnection) {
            await clientConnection.close();
        }
    }
})();
