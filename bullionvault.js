// --- Module-level regexes and helpers (kept simple and documented) ---
// Match either 'Summary:' or 'Deal:' and capture Buy/Sell, quantity and price-per-kg
const SUMMARY_OR_DEAL_RE = /(?:Summary|Deal):\s*(Buy|Sell)\s*([0-9.,]+)\s*kg\s*@[^/]*?([0-9,]+(?:\.[0-9]+)?)\s*\/kg/i;

// Match consideration / net consideration lines: optional Security{...}, optional 3-letter currency, then amount
const CONSIDERATION_RE = /(?:Net\s+consideration|Consideration):\s*(?:Security\{[^}]*\}\s*)?(?:([A-Z]{3})\s*)?([0-9,]+(?:\.[0-9]+)?)/i;
// Commission line: optional Security{...}, optional currency, then amount
const COMMISSION_RE = /Commission:\s*(?:Security\{[^}]*\}\s*)?(?:([A-Z]{3})\s*)?([0-9,]+(?:\.[0-9]+)?)/i;
// Total cost / received / Total: optional currency + amount
const TOTAL_RE = /(?:Total cost):\s*(?:Security\{[^}]*\}\s*)?(?:([A-Z]{3})\s*)?([0-9,]+(?:\.[0-9]+)?)/i;
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

    // Backwards-compat parseFile helper: parse an array of email strings
    async parseContent(emailStrings) {
        if (!Array.isArray(emailStrings)) {
            throw new Error('parseContent expects an array of email strings');
        }
        const results = [];
        for (let i = 0; i < emailStrings.length; i++) {
            const src = emailStrings[i];
            const label = `email[${i}]`;
            const tx = await this.parseEmailString(src, label);
            if (tx) results.push(tx);
        }
        return results;
    }

    // Parse a single email provided as a raw string. sourceLabel is used for error messages.
    async parseEmailString(rawContent, sourceLabel) {
            let content = this.decodeQuotedPrintable(rawContent);
            content = this.stripHtml(content);

            // Use module-level regexes and helpers (SUMMARY_OR_DEAL_RE, CONSIDERATION_RE, etc.)
            const summaryOrDealMatch = content.match(SUMMARY_OR_DEAL_RE);
            const considerationMatch = content.match(CONSIDERATION_RE);
            const commissionMatch = content.match(COMMISSION_RE);
            const totalMatch = content.match(TOTAL_RE);
            const dealTimeMatch = content.match(DEALTIME_RE);
            
            let kind, quantity, pricePerKg;
            if (summaryOrDealMatch) {
                kind = summaryOrDealMatch[1].toUpperCase();
                quantity = parseNumber(summaryOrDealMatch[2]);
                pricePerKg = parseNumber(summaryOrDealMatch[3]);
            } else {
                throw new Error(`Unparseable BullionVault email: missing Summary/Deal line in ${sourceLabel}`);
            }

            const considerationCurrency = considerationMatch && considerationMatch[1] ? considerationMatch[1].toUpperCase() : null;
            const commissionCurrency = commissionMatch && commissionMatch[1] ? commissionMatch[1].toUpperCase() : null;
            const totalCurrency = totalMatch && totalMatch[1] ? totalMatch[1].toUpperCase() : null;

            const consideration = considerationMatch ? parseNumber(considerationMatch[2]) : null;
            const commission = commissionMatch ? parseNumber(commissionMatch[2]) : null;
            const total = totalMatch ? parseNumber(totalMatch[2]) : null;

            // Fail-fast: commissions/consideration must be in GBP for this dataset. If any present currency is not GBP, fail.
            const currencies = [considerationCurrency, commissionCurrency, totalCurrency].filter(Boolean);
            if (currencies.length > 0) {
                for (const cur of currencies) {
                    if (cur !== 'GBP') {
                        throw new Error(`Unsupported currency '${cur}' in ${sourceLabel} — only GBP allowed`);
                    }
                }
            }

            // Fail-fast: commission (expenses) must be present and numeric for bullionvault emails
            if (!isFinite(commission) || Number.isNaN(commission)) {
                throw new Error(`Missing or unparsable commission/expenses in ${sourceLabel}`);
            }

            // Explicit asset matchers and detection helper
            const ASSET_MATCHERS = [
                // Match explicit gold tokens and common tickers
                { asset: 'GOLD', regex: /\b(gold|xau|gold kilos?)\b/i },
                // Match explicit silver tokens and common tickers
                { asset: 'SILVER', regex: /\b(silver|xag|silver kilos?)\b/i },
            ];

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
                const headerDateMatch = rawContent.match(/^Date:\s*(.+)$/m);
                if (headerDateMatch) {
                    date = this.formatDate(headerDateMatch[1].trim());
                }
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
        return '';
    }

    // parseToFormat now accepts an array of raw email strings and returns formatted lines.
    // This keeps all file I/O in index.js.
    async parseToFormat(emailStrings) {
        const transactions = await this.parseContent(emailStrings);
        return transactions.map(transaction => this.formatTransaction(transaction));
    }

    decodeQuotedPrintable(str) {
        if (typeof str !== 'string') throw new Error('decodeQuotedPrintable expected a string');
        // Remove soft line breaks
        let out = str.replace(/=\r?\n/g, '');
        // Decode hex escapes =HH
        out = out.replace(/=([0-9A-F]{2})/gi, (m, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
        return out;
    }

    stripHtml(html) {
        if (typeof html !== 'string') throw new Error('stripHtml expected a string');
        let txt = html.replace(/<[^>]*>/g, '');
        txt = txt.replace(/&nbsp;/gi, ' ');
        txt = txt.replace(/&amp;/gi, '&');
        txt = txt.replace(/&lt;/gi, '<');
        txt = txt.replace(/&gt;/gi, '>');
        txt = txt.replace(/\s+/g, ' ').trim();
        if (!txt) throw new Error('stripHtml resulted in empty string');
        return txt;
    }

}

module.exports = BullionVaultParser;
