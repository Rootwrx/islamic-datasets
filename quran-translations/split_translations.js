import fs from 'fs/promises';
import path from 'path';

// Function to ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Convert array of objects to CSV
function objectsToCSV(data, includeHeaders = true) {
  if (!data || data.length === 0) return '';

  // Determine all possible headers from all objects
  const allHeaders = new Set();
  data.forEach(obj => {
    Object.keys(obj).forEach(key => allHeaders.add(key));

    // Also add keys from nested surahs if they exist
    if (obj.surahs) {
      for (const surahNum in obj.surahs) {
        const ayahs = obj.surahs[surahNum];
        if (ayahs && ayahs.length > 0) {
          Object.keys(ayahs[0]).forEach(key => allHeaders.add(`ayah_${key}`));
        }
      }
    }
  });

  const headers = Array.from(allHeaders);
  let csv = includeHeaders ? headers.join(',') + '\n' : '';

  for (const row of data) {
    const values = headers.map(header => {
      // Handle nested surahs structure
      if (header.startsWith('ayah_') && row.surahs) {
        // This is a placeholder - we'll handle surahs separately
        return '';
      }

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

// Function to flatten translation JSON for CSV export
function flattenTranslationForCSV(translation) {
  const flattened = [];

  const { translation_key, language_code, translation_title, translation_version, surahs } = translation;

  // For each surah and ayah, create a flattened record
  for (const surahNum in surahs) {
    const ayahs = surahs[surahNum];

    for (const ayah of ayahs) {
      flattened.push({
        translation_key,
        language_code,
        translation_title,
        translation_version: translation_version || '',
        surah: surahNum,
        ayah: ayah.ayah,
        arabic_text: ayah.arabic_text,
        translation: ayah.translation,
        footnotes: ayah.footnotes || ''
      });
    }
  }

  return flattened;
}

// Function to read the full translations JSON file in chunks
async function* readJsonInChunks(filePath) {
  const fileHandle = await fs.open(filePath, 'r');
  const stats = await fileHandle.stat();
  const fileSize = stats.size;

  // Skip the opening bracket
  let position = 1;
  let buffer = Buffer.alloc(1024 * 1024); // 1MB buffer
  let leftover = '';
  let objectCount = 0;

  while (position < fileSize - 1) { // -1 to skip the closing bracket
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;

    position += bytesRead;

    // Convert buffer to string and combine with leftover
    const chunk = leftover + buffer.toString('utf8', 0, bytesRead);

    // Find complete JSON objects
    let startIdx = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') bracketCount++;
        else if (char === '}') {
          bracketCount--;

          // Complete object found
          if (bracketCount === 0) {
            const jsonStr = chunk.substring(startIdx, i + 1);
            try {
              const obj = JSON.parse(jsonStr);
              objectCount++;
              yield obj;
            } catch (e) {
              console.error(`Error parsing JSON object #${objectCount + 1}:`, e.message);
            }

            // Skip the comma and whitespace after the object
            let nextStart = i + 1;
            while (nextStart < chunk.length &&
              (chunk[nextStart] === ',' ||
              chunk[nextStart] === '\n' ||
              chunk[nextStart] === ' ')) {
              nextStart++;
              }

              startIdx = nextStart;
            i = nextStart - 1; // -1 because the loop will increment i
          }
        }
      }
    }

    // Save any incomplete object for the next iteration
    leftover = chunk.substring(startIdx);
  }

  await fileHandle.close();
  console.log(`Processed ${objectCount} objects from JSON file`);
}

// Function to organize translations by language and version
async function organizeTranslations() {
  console.log("Starting to organize translations...");

  // Track languages and versions
  const languageMap = new Map();
  const versionMap = new Map();
  let translationCount = 0;

  // Process each translation from the full file
  for await (const translation of readJsonInChunks(path.join('datasets', 'all_translations.json'))) {
    translationCount++;

    if (translationCount % 10 === 0) {
      console.log(`Processed ${translationCount} translations`);
    }

    const { language_code, translation_key, translation_version } = translation;

    // Add to language map
    if (!languageMap.has(language_code)) {
      languageMap.set(language_code, []);
    }
    languageMap.get(language_code).push(translation);

    // Add to version map (language + version)
    const versionKey = `${language_code}_${translation_version || 'default'}`;
    if (!versionMap.has(versionKey)) {
      versionMap.set(versionKey, []);
    }
    versionMap.get(versionKey).push(translation);

    // Save individual translation file in its existing directory
    const translationDir = path.join('datasets', language_code, translation_key);

    // Check if directory exists
    try {
      await fs.access(translationDir);
      // Save full translation JSON in the existing translation directory
      await fs.writeFile(
        path.join(translationDir, 'full_translation.json'),
                         JSON.stringify(translation, null, 2)
      );

      // Create flattened CSV version for individual translation
      const flattenedData = flattenTranslationForCSV(translation);
      if (flattenedData.length > 0) {
        const csvContent = objectsToCSV(flattenedData);
        await fs.writeFile(
          path.join(translationDir, 'full_translation_flat.csv'),
                           csvContent
        );
      }
    } catch (error) {
      console.log(`Directory not found for ${translation_key}, skipping individual file`);
    }
  }

  console.log(`Total translations processed: ${translationCount}`);

  // Save language files in their respective language directories
  console.log("Saving language files...");
  for (const [language, translations] of languageMap.entries()) {
    console.log(`Saving language file for ${language} with ${translations.length} translations`);

    const languageDir = path.join('datasets', language);

    // Check if language directory exists
    try {
      await fs.access(languageDir);

      // Save combined language file (JSON)
      await fs.writeFile(
        path.join(languageDir, 'full_language_translations.json'),
                         JSON.stringify(translations, null, 2)
      );

      // Create flattened CSV version for language
      console.log(`Creating CSV for language ${language}...`);
      let allFlattenedData = [];

      // Flatten each translation
      for (const translation of translations) {
        const flattenedData = flattenTranslationForCSV(translation);
        allFlattenedData = allFlattenedData.concat(flattenedData);
      }

      // Save in chunks to avoid memory issues
      const chunkSize = 10000;
      let chunkIndex = 0;

      for (let i = 0; i < allFlattenedData.length; i += chunkSize) {
        const chunk = allFlattenedData.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;

        // Write headers only for the first chunk
        const csvContent = objectsToCSV(chunk, isFirstChunk);

        if (isFirstChunk) {
          await fs.writeFile(
            path.join(languageDir, 'full_language_translations.csv'),
                             csvContent
          );
        } else {
          await fs.appendFile(
            path.join(languageDir, 'full_language_translations.csv'),
                              csvContent
          );
        }

        chunkIndex++;
        console.log(`Saved chunk ${chunkIndex} for language ${language}`);
      }

    } catch (error) {
      console.log(`Language directory not found for ${language}, creating it`);
      await ensureDir(languageDir);

      // Save combined language file (JSON)
      await fs.writeFile(
        path.join(languageDir, 'full_language_translations.json'),
                         JSON.stringify(translations, null, 2)
      );

      // Create CSV version (same process as above)
      console.log(`Creating CSV for language ${language}...`);
      let allFlattenedData = [];

      for (const translation of translations) {
        const flattenedData = flattenTranslationForCSV(translation);
        allFlattenedData = allFlattenedData.concat(flattenedData);
      }

      const chunkSize = 10000;
      let chunkIndex = 0;

      for (let i = 0; i < allFlattenedData.length; i += chunkSize) {
        const chunk = allFlattenedData.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;

        const csvContent = objectsToCSV(chunk, isFirstChunk);

        if (isFirstChunk) {
          await fs.writeFile(
            path.join(languageDir, 'full_language_translations.csv'),
                             csvContent
          );
        } else {
          await fs.appendFile(
            path.join(languageDir, 'full_language_translations.csv'),
                              csvContent
          );
        }

        chunkIndex++;
        console.log(`Saved chunk ${chunkIndex} for language ${language}`);
      }
    }
  }

  // Save version files in their respective language directories
  console.log("Saving version files...");
  for (const [versionKey, translations] of versionMap.entries()) {
    const [language, version] = versionKey.split('_');
    console.log(`Saving version file for ${language} (${version}) with ${translations.length} translations`);

    const languageDir = path.join('datasets', language);

    // Check if language directory exists
    try {
      await fs.access(languageDir);

      // Save version file in language directory (JSON)
      await fs.writeFile(
        path.join(languageDir, `version_${version}_translations.json`),
                         JSON.stringify(translations, null, 2)
      );

      // Create CSV version for version
      console.log(`Creating CSV for ${language} version ${version}...`);
      let allFlattenedData = [];

      for (const translation of translations) {
        const flattenedData = flattenTranslationForCSV(translation);
        allFlattenedData = allFlattenedData.concat(flattenedData);
      }

      const chunkSize = 10000;
      let chunkIndex = 0;

      for (let i = 0; i < allFlattenedData.length; i += chunkSize) {
        const chunk = allFlattenedData.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;

        const csvContent = objectsToCSV(chunk, isFirstChunk);

        if (isFirstChunk) {
          await fs.writeFile(
            path.join(languageDir, `version_${version}_translations.csv`),
                             csvContent
          );
        } else {
          await fs.appendFile(
            path.join(languageDir, `version_${version}_translations.csv`),
                              csvContent
          );
        }

        chunkIndex++;
        console.log(`Saved chunk ${chunkIndex} for ${language} version ${version}`);
      }

    } catch (error) {
      console.log(`Language directory not found for ${language}, creating it`);
      await ensureDir(languageDir);

      // Save version file (JSON)
      await fs.writeFile(
        path.join(languageDir, `version_${version}_translations.json`),
                         JSON.stringify(translations, null, 2)
      );

      // Create CSV version (same process as above)
      console.log(`Creating CSV for ${language} version ${version}...`);
      let allFlattenedData = [];

      for (const translation of translations) {
        const flattenedData = flattenTranslationForCSV(translation);
        allFlattenedData = allFlattenedData.concat(flattenedData);
      }

      const chunkSize = 10000;
      let chunkIndex = 0;

      for (let i = 0; i < allFlattenedData.length; i += chunkSize) {
        const chunk = allFlattenedData.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;

        const csvContent = objectsToCSV(chunk, isFirstChunk);

        if (isFirstChunk) {
          await fs.writeFile(
            path.join(languageDir, `version_${version}_translations.csv`),
                             csvContent
          );
        } else {
          await fs.appendFile(
            path.join(languageDir, `version_${version}_translations.csv`),
                              csvContent
          );
        }

        chunkIndex++;
        console.log(`Saved chunk ${chunkIndex} for ${language} version ${version}`);
      }
    }
  }

  // Create index file with metadata
  const indexData = {
    total_translations: translationCount,
    languages: Array.from(languageMap.keys()).map(lang => ({
      code: lang,
      translation_count: languageMap.get(lang).length,
                                                           versions: Array.from(versionMap.keys())
                                                           .filter(key => key.startsWith(`${lang}_`))
                                                           .map(key => key.split('_')[1])
    }))
  };

  await fs.writeFile(
    path.join('datasets', 'translations_index.json'),
                     JSON.stringify(indexData, null, 2)
  );

  console.log("Organization complete!");
  console.log(`Total languages: ${languageMap.size}`);
  console.log(`Total version combinations: ${versionMap.size}`);

  return {
    translationCount,
    languageCount: languageMap.size,
    versionCount: versionMap.size
  };
}

// Main function
async function main() {
  try {
    console.log("Starting translation file splitter");

    // Check if the source file exists
    try {
      await fs.access(path.join('datasets', 'all_translations.json'));
    } catch (error) {
      console.error("Error: all_translations.json file not found in the datasets directory");
      return;
    }

    // Organize translations
    const stats = await organizeTranslations();

    console.log("\n✅ Translation splitting complete!");
    console.log(`📊 Successfully processed ${stats.translationCount} translations`);
    console.log(`🌐 Split into ${stats.languageCount} language files`);
    console.log(`📚 Created ${stats.versionCount} version-specific files`);

    // Print structure guide
    console.log("\n📂 New Dataset Structure:");
    console.log("datasets/");
    console.log("├── translations_index.json         # Metadata about all translations");
    console.log("└── {language_code}/               # Folder for each language");
    console.log("    ├── full_language_translations.json  # All translations for this language (JSON)");
    console.log("    ├── full_language_translations.csv   # All translations for this language (CSV)");
    console.log("    ├── version_*.json              # All translations for a specific version (JSON)");
    console.log("    ├── version_*.csv               # All translations for a specific version (CSV)");
    console.log("    └── {translation_key}/         # Folder for each translation");
    console.log("        ├── full_translation.json   # Individual translation file (JSON)");
    console.log("        └── full_translation_flat.csv # Individual translation file (CSV)");

  } catch (error) {
    console.error("❌ Error in main process:", error.message);
    console.error(error.stack);
  }
}

// Run the main function
main();
