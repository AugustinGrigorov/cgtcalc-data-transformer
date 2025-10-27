// --- Module-level regexes and helpers (kept simple and documented) ---
// Match either 'Summary:' or 'Deal:' and capture Buy/Sell, quantity and price-per-kg
const SUMMARY_OR_DEAL_RE = /(?:Summary|Deal):\s*(Buy|Sell)\s*([0-9.,]+)\s*kg\s*@[^/]*?([0-9,]+(?:\.[0-9]+)?)\s*\/kg/i;

// Match consideration / net consideration lines: optional Security{...}, optional 3-letter currency, then amount
// const CONSIDERATION_RE = /(?:Net\s+consideration|Consideration):\s*(?:Security\{[^}]*\}\s*)?(?:([A-Z]{3})\s*)?([0-9,]+(?:\.[0-9]+)?)/i;
const CONSIDERATION_RE = /(?:Net\s+consideration|Consideration):\s*(?:.*=')?([A-Z]{3})(?:'})?\s([0-9,]+(?:\.[0-9]+)?)/i;
// Commission line: optional Security{...}, optional currency, then amount
const COMMISSION_RE = /(?:Commission):\s*(?:.*=')?([A-Z]{3})(?:'})?\s([0-9,]+(?:\.[0-9]+)?)/i;
// Capture the deal time line up to newline
const DEALTIME_RE = /Deal time:\s*([^\r\n]+)/i;

// Simple number parser to normalize commas and parse floats
function parseNumber(str) {
    return parseFloat(String(str).replace(/,/g, ''));
}

// Asset matchers used to detect GOLD / SILVER from Security line or body
const ASSET_MATCHERS = [
    { asset: 'GOLD', regex: /\b(gold?)\b/i },
    { asset: 'SILVER', regex: /\b(silver?)\b/i },
];

function detectAsset(text, filePath) {
    const securityMatchLocal = text.match(/Security:\s*([^\r\n]+)/i);
    const toCheck = securityMatchLocal ? securityMatchLocal[1] : text;
    for (const m of ASSET_MATCHERS) if (m.regex.test(toCheck)) return m.asset;
    for (const m of ASSET_MATCHERS) if (m.regex.test(text)) return m.asset;
    throw new Error(`Unable to detect asset type (gold/silver) in ${filePath}`);
}


/**
 * BullionVault Email Parser
 * Extracts gold transaction data from BullionVault email files
 */
class BullionVaultParser {
    async parseToFormat(emailString) {
        const emailStrings = emailString.split('\nEOF\n');
        // parseEmailString is async; run them in parallel and wait for all to complete
        const transactions = await Promise.all(
            emailStrings.map((email, index) => this.parseEmailString(email, `email[${index}]`))
        );
        return transactions.map(transaction => this.formatTransaction(transaction));
    }

    // Parse a single email provided as a raw string. sourceLabel is used for error messages.
    async parseEmailString(content, sourceLabel) {
        // Use module-level regexes and helpers (SUMMARY_OR_DEAL_RE, CONSIDERATION_RE, etc.)
        const summaryOrDealMatch = content.match(SUMMARY_OR_DEAL_RE);
        const considerationMatch = content.match(CONSIDERATION_RE);
        const commissionMatch = content.match(COMMISSION_RE);
        const dealTimeMatch = content.match(DEALTIME_RE);
        const kind = summaryOrDealMatch[1].toUpperCase();
        const quantity = parseNumber(summaryOrDealMatch[2]);
        const pricePerKg = parseNumber(summaryOrDealMatch[3]);
        const considerationCurrency = considerationMatch[1].toUpperCase();
        const commissionCurrency = commissionMatch[1].toUpperCase();

        const commission = parseNumber(commissionMatch[2]);

        // Fail-fast: commissions/consideration must be in GBP for this dataset. If any present currency is not GBP, fail.
        const currencies = [considerationCurrency, commissionCurrency].filter(Boolean);
        for (const cur of currencies) {
            if (cur !== 'GBP') {
                throw new Error(`Unsupported currency '${cur}' in ${sourceLabel} — only GBP allowed`);
            }
        }

        // Fail-fast: commission (expenses) must be present and numeric for bullionvault emails
        if (!isFinite(commission) || Number.isNaN(commission)) {
            throw new Error(`Missing or unparsable commission/expenses in ${sourceLabel}`);
        }

        const assetDetected = detectAsset(content, sourceLabel);

        if (!isFinite(quantity) || Number.isNaN(quantity) || quantity === 0) {
            throw new Error(`Invalid quantity parsed from email ${sourceLabel}: ${quantity}`);
        }
        if (!isFinite(pricePerKg) || Number.isNaN(pricePerKg) || pricePerKg <= 0) {
            throw new Error(`Invalid price parsed from email ${sourceLabel}: ${pricePerKg}`);
        }

        let date = null;

        if (dealTimeMatch) {
            const dtRaw = dealTimeMatch[1].trim();
            const dtPartMatch = dtRaw.match(/([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:\s+at\s+[^G]+GMT)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i);
            const dtForFormat = dtPartMatch ? dtPartMatch[1] : dtRaw;
            date = this.formatDate(dtForFormat.trim());
        }

        if (!date) {
            throw new Error(`No parsable date found in ${sourceLabel}`);
        }

        return {
            kind,
            date,
            asset: assetDetected,
            amount: quantity,
            price: pricePerKg,
            expenses: commission
        };

    }

    formatDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            throw new Error(`formatDate expected a non-empty string, got: ${typeof dateString}`);
        }

        const cleanDate = dateString.trim();
        // Normalize: remove stray 'at' tokens and common timezone abbreviations so parsing is unified
        const normalized = cleanDate.replace(/\bat\b/gi, '').replace(/\b(GMT|UTC|BST)\b/gi, '').trim();

        const date = new Date(normalized);
        if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }

        const dateMatch = cleanDate.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
        if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const monthName = dateMatch[2];
            const year = dateMatch[3];
            const monthNum = new Date(`${monthName} 1, ${year}`).getMonth() + 1;
            return `${day}/${String(monthNum).padStart(2, '0')}/${year}`;
        }

        throw new Error(`Unparsable date string: '${dateString}'`);
    }

    formatTransaction(transaction) {
        if (transaction.kind === 'BUY' || transaction.kind === 'SELL') {
            return `${transaction.kind} ${transaction.date} ${transaction.asset} ${transaction.amount} ${transaction.price} ${transaction.expenses}`;
        }
        throw new Error(`Unsupported transaction kind: ${transaction.kind}`);
    }

}

module.exports = BullionVaultParser;
