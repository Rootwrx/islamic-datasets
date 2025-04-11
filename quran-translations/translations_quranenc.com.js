import fs from 'fs/promises';
import path from 'path';

// Base API URL
const API_BASE_URL = 'https://quranenc.com/api/v1';

// Create directory if it doesn't exist
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

// Fetch data from API
async function fetchAPI(endpoint) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`);
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, error.message);
        throw error;
    }
}

// Convert array of objects to CSV
function objectsToCSV(data, includeHeaders = true) {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    let csv = includeHeaders ? headers.join(',') + '\n' : '';

    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header]?.toString() || '';
            // Escape quotes and wrap in quotes if contains comma, newline or quote
            if (value.includes(',') || value.includes('\n') || value.includes('"')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csv += values.join(',') + '\n';
    }

    return csv;
}

// Get all available translations
async function getAvailableTranslations() {
    const data = await fetchAPI('/translations/list');
    return data.translations;
}

// Get all available languages
async function getAvailableLanguages() {
    const data = await fetchAPI('/translations/languages');
    return data.languages;
}

// Get all surahs for a specific translation
async function getTranslationForAllSurahs(translationKey) {
    const allSurahsData = [];

    // There are 114 surahs in the Quran
    for (let surahNumber = 1; surahNumber <= 114; surahNumber++) {
        try {
            console.log(`Fetching surah ${surahNumber} for translation ${translationKey}...`);
            const data = await fetchAPI(`/translation/sura/${translationKey}/${surahNumber}`);

            if (data.result && Array.isArray(data.result)) {
                // Add surah number to each ayah for easier identification
                allSurahsData.push(...data.result);
            }

            // Add a small delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
            console.error(`Error fetching surah ${surahNumber} for ${translationKey}:`, error.message);
            // If we encounter an error, wait a bit longer before continuing
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    return allSurahsData;
}

// Process and save translation data
async function processTranslation(translation, allTranslationsData) {
    const { key, language_iso_code, title, version } = translation;
    console.log(`\nProcessing translation: ${title} (${key})`);

    try {
        // Create directory for this translation
        const translationDir = path.join('datasets', language_iso_code, key);
        await ensureDir(translationDir);

        // Save translation metadata
        await fs.writeFile(
            path.join(translationDir, 'metadata.json'),
                           JSON.stringify(translation, null, 2)
        );

        // Get all surahs for this translation
        const allAyahs = await getTranslationForAllSurahs(key);

        if (allAyahs.length === 0) {
            console.log(`No data found for translation ${key}`);
            return null;
        }

        // Prepare data for CSV
        const processedData = allAyahs.map(ayah => ({
            surah: ayah.sura,
            ayah: ayah.aya,
            arabic_text: ayah.arabic_text,
            translation: ayah.translation.replace(/\n/g, ' '),
                                                    footnotes: ayah.footnotes ? ayah.footnotes.replace(/\n/g, ' ') : ''
        }));

        // Save as CSV
        const csvContent = objectsToCSV(processedData);
        await fs.writeFile(path.join(translationDir, 'full_translation.csv'), csvContent);

        // Create separate files for each surah
        const surahGroups = {};
        for (const ayah of processedData) {
            if (!surahGroups[ayah.surah]) {
                surahGroups[ayah.surah] = [];
            }
            surahGroups[ayah.surah].push(ayah);
        }

        // Save individual surah files
        for (const [surahNum, ayahs] of Object.entries(surahGroups)) {
            const surahCsv = objectsToCSV(ayahs);
            await fs.writeFile(path.join(translationDir, `surah_${surahNum.padStart(3, '0')}.csv`), surahCsv);
        }

        // Create a parallel corpus file (Arabic + Translation)
        const parallelCorpus = processedData.map(ayah => ({
            surah: ayah.surah,
            ayah: ayah.aya,
            arabic: ayah.arabic_text,
            translation: ayah.translation
        }));

        await fs.writeFile(
            path.join(translationDir, 'parallel_corpus.csv'),
                           objectsToCSV(parallelCorpus)
        );

        // Add data to the consolidated dataset
        const enhancedData = processedData.map(ayah => ({
            translation_key: key,
            language_code: language_iso_code,
            translation_title: title,
            translation_version: version,
            surah: ayah.surah,
            ayah: ayah.aya,
            arabic_text: ayah.arabic_text,
            translation: ayah.translation,
            footnotes: ayah.footnotes || ''
        }));

        allTranslationsData.push(...enhancedData);

        // Prepare data for the consolidated JSON
        const jsonData = {
            translation_key: key,
            language_code: language_iso_code,
            translation_title: title,
            translation_version: version,
            surahs: {}
        };

        // Group by surah for JSON structure
        for (const ayah of processedData) {
            if (!jsonData.surahs[ayah.surah]) {
                jsonData.surahs[ayah.surah] = [];
            }

            jsonData.surahs[ayah.surah].push({
                ayah: ayah.aya,
                arabic_text: ayah.arabic_text,
                translation: ayah.translation,
                footnotes: ayah.footnotes || ''
            });
        }

        console.log(`✅ Successfully processed translation: ${key}`);
        return {
            key,
            language: language_iso_code,
            ayah_count: allAyahs.length,
            json_data: jsonData
        };
    } catch (error) {
        console.error(`Error processing translation ${key}:`, error.message);
        return {
            key,
            language: language_iso_code,
            error: error.message
        };
    }
}

// Modified saveChunkedData function to properly append chunks
async function saveChunkedData(allTranslationsData, chunkSize = 1000, isFirstChunk = false) {
    console.log(`\n📊 ${isFirstChunk ? "Creating" : "Updating"} consolidated CSV file with all translations...`);

    if (allTranslationsData.length === 0) {
        console.log("⚠️ No data available for this chunk");
        return;
    }

    // Create the file with headers only for the first chunk
    if (isFirstChunk) {
        const headers = Object.keys(allTranslationsData[0]).join(',') + '\n';
        await fs.writeFile(path.join('datasets', 'all_translations.csv'), headers);
    }

    // Process in chunks to avoid memory issues
    for (let i = 0; i < allTranslationsData.length; i += chunkSize) {
        const chunk = allTranslationsData.slice(i, i + chunkSize);
        const chunkCsv = objectsToCSV(chunk, false); // Don't include headers for chunks

        // Append to the file
        await fs.appendFile(path.join('datasets', 'all_translations.csv'), chunkCsv);
        console.log(`Saved chunk of ${chunk.length} entries`);
    }

    console.log("✅ CSV data saved successfully");
}

// Modified saveJsonData function to correctly build the complete JSON file
async function saveJsonData(allTranslationsJSON, isFirstChunk = false, isFinalChunk = false) {
    console.log(`📊 ${isFirstChunk ? "Creating" : "Updating"} consolidated JSON file with all translations...`);

    if (allTranslationsJSON.length === 0) {
        console.log("⚠️ No data available for this chunk");
        return;
    }

    if (isFirstChunk) {
        // Write the opening bracket only at the beginning
        await fs.writeFile(path.join('datasets', 'all_translations.json'), '[\n');
    }

    // Write each translation with proper comma handling
    for (let i = 0; i < allTranslationsJSON.length; i++) {
        const jsonStr = JSON.stringify(allTranslationsJSON[i], null, 2);
        const isLast = i === allTranslationsJSON.length - 1;

        // Add a comma if it's not the very last item in the final chunk
        const needsComma = !(isLast && isFinalChunk);

        await fs.appendFile(
            path.join('datasets', 'all_translations.json'),
                            jsonStr + (needsComma ? ',\n' : '\n')
        );

        if ((i + 1) % 10 === 0 || isLast) {
            console.log(`Saved ${i + 1}/${allTranslationsJSON.length} translations in this chunk`);
        }
    }

    if (isFinalChunk) {
        // Write the closing bracket only at the end
        await fs.appendFile(path.join('datasets', 'all_translations.json'), ']');
        console.log("✅ Consolidated JSON file completed successfully");
    }
}

// Main function
async function main() {
    try {
        console.log("🔄 Starting Quran Translation Dataset Generator");

        // Create base directory
        await ensureDir('datasets');

        // Get all available translations
        console.log("📚 Fetching available translations...");
        const translations = await getAvailableTranslations();
        console.log(`Found ${translations.length} translations`);

        // Get all available languages
        console.log("🌐 Fetching available languages...");
        const languages = await getAvailableLanguages();
        console.log(`Found ${languages.length} languages`);

        // Save list of all translations and languages
        await fs.writeFile(
            path.join('datasets', 'translations_list.json'),
                           JSON.stringify(translations, null, 2)
        );

        await fs.writeFile(
            path.join('datasets', 'languages_list.json'),
                           JSON.stringify(languages, null, 2)
        );

        // Process ALL translations (no slice)
        const translationsToProcess = translations;
        console.log(`Will process all ${translationsToProcess.length} translations`);

        // Arrays to store consolidated data - DEFINE THEM HERE
        const allTranslationsData = [];
        const allTranslationsJSON = [];

        // Process each translation
        const results = [];
        let successCount = 0;
        let errorCount = 0;

        // Variables to track chunking
        let firstCSVChunk = true;
        let firstJSONChunk = true;

        for (let i = 0; i < translationsToProcess.length; i++) {
            const translation = translationsToProcess[i];
            console.log(`\nProcessing translation ${i+1}/${translationsToProcess.length}: ${translation.key}`);

            const result = await processTranslation(translation, allTranslationsData);

            if (result) {
                results.push(result);
                if (result.json_data) {
                    allTranslationsJSON.push(result.json_data);
                    successCount++;
                } else {
                    errorCount++;
                }
            } else {
                errorCount++;
            }

            // Save progress periodically
            if (i % 5 === 0 || i === translationsToProcess.length - 1) {
                await fs.writeFile(
                    path.join('datasets', 'processing_progress.json'),
                                   JSON.stringify({
                                       total: translationsToProcess.length,
                                       processed: i + 1,
                                       success: successCount,
                                       error: errorCount,
                                       last_processed: translation.key
                                   }, null, 2)
                );
            }

            // Save data in chunks to avoid memory issues
            if (allTranslationsData.length > 10000 || i === translationsToProcess.length - 1) {
                await saveChunkedData(allTranslationsData, 1000, firstCSVChunk);
                firstCSVChunk = false;
                // Clear the array after saving to free memory
                allTranslationsData.length = 0;
            }

            // Save JSON data in chunks
            if (allTranslationsJSON.length > 20 || i === translationsToProcess.length - 1) {
                const isFinalChunk = i === translationsToProcess.length - 1;
                await saveJsonData(allTranslationsJSON, firstJSONChunk, isFinalChunk);
                firstJSONChunk = false;
                // Clear the array after saving to free memory
                allTranslationsJSON.length = 0;
            }
        }

        // Save final summary
        await fs.writeFile(
            path.join('datasets', 'processing_summary.json'),
                           JSON.stringify({
                               total: translationsToProcess.length,
                               success: successCount,
                               error: errorCount,
                               results: results.map(r => ({
                                   key: r.key,
                                   language: r.language,
                                   ayah_count: r.ayah_count,
                                   error: r.error
                               }))
                           }, null, 2)
        );

        console.log("\n✅ Dataset generation complete!");
        console.log(`📊 Successfully processed ${successCount} translations`);
        console.log(`⚠️ Encountered errors in ${errorCount} translations`);
        console.log("📁 Data saved in the 'datasets' directory");

        // Print structure guide
        console.log("\n📂 Dataset Structure:");
        console.log("datasets/");
        console.log("├── translations_list.json       # List of all available translations");
        console.log("├── languages_list.json          # List of all available languages");
        console.log("├── processing_summary.json      # Summary of processed translations");
        console.log("├── all_translations.csv         # Consolidated CSV with all translations");
        console.log("├── all_translations.json        # Consolidated JSON with all translations");
        console.log("└── {language_code}/            # Folder for each language");
        console.log("    └── {translation_key}/      # Folder for each translation");
        console.log("        ├── metadata.json       # Translation metadata");
        console.log("        ├── full_translation.csv # Complete translation");
        console.log("        ├── parallel_corpus.csv  # Arabic text with translation");
        console.log("        └── surah_*.csv         # Individual surah files");

    } catch (error) {
        console.error("❌ Error in main process:", error.message);
        console.error(error.stack);
    }
}

// Run the main function
main();
