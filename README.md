# Quran Translations Dataset

## Overview
This dataset contains translations of the Holy Quran in multiple languages. It includes 63 translations across 49 different languages, each with various versions and translators.

## Dataset Structure

### Root Directory
The root directory contains:
- `translations_index.json`: Index of all translations with language codes and version information
- `languages_list.json`: List of all language ISO codes in the dataset
- `translations_list.json`: Detailed information about each translation including metadata
- Language-specific directories: One directory per language (e.g., 'en', 'fr', 'ar', etc.)
- `split_translations.js`: Script for processing translations

### Language Directories
Each language directory (identified by ISO code) contains:
- `full_language_translations.csv/.json`: Consolidated file with all translations for that language
- Version-specific files (e.g., `version_1.1.1_translations.csv/.json`): Translations for specific versions
- Translator-specific directories: One directory per translator/translation edition

### Translator Directories
Each translator directory contains:
- `full_translation.json`: Complete translation by this translator
- `full_translation_flat.csv`: Flattened version of the complete translation
- `parallel_corpus.csv`: Parallel corpus for this translation
- Individual surah files: One CSV file per surah (chapter) of the Quran, named `surah_XXX.csv` where XXX is the surah number (001-114)

### File Formats
The dataset provides translations in both CSV and JSON formats:

#### CSV Format
The CSV files for surahs contain the following columns:
- `surah`: Surah (chapter) number
- `ayah`: Ayah (verse) number
- `arabic_text`: Original Arabic text of the verse
- `translation`: Translated text
- `footnotes`: Optional explanatory notes for the translation

Example:
```
surah,ayah,arabic_text,translation,footnotes
1,1,بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ,"In the name of Allah, the Entirely Merciful, the Especially Merciful.","[Footnote text here]"
```

#### JSON Format
The JSON files contain the same information in a structured format.

## Translation Metadata
Each translation in the dataset includes metadata:
- `key`: Unique identifier for the translation (e.g., "english_saheeh")
- `direction`: Text direction ("ltr" or "rtl")
- `language_iso_code`: ISO code for the language
- `version`: Version of the translation
- `last_update`: Timestamp of the last update
- `title`: Title of the translation
- `description`: Detailed description including translator information

Example:
```json
{
  "key": "english_saheeh",
  "direction": "ltr",
  "language_iso_code": "en",
  "version": "1.1.1",
  "last_update": 1658318019,
  "title": "English Translation - Saheeh International",
  "description": "Translation of the Quran meanings into English - Saheeh International - Al-Muntada Al-Islami (Islamic Forum)"
}
```

## Supported Languages
The dataset includes translations for 49 languages, including:
- Arabic (ar)
- English (en)
- French (fr)
- Spanish (es)
- German (de)
- Turkish (tr)
- Indonesian (id)
- Urdu (ur)
- Hindi (hi)
- Chinese (zh)
- Japanese (ja)
- Russian (ru)
- And many other languages from different regions of the world

## Usage
This dataset is useful for:
- Comparative religious studies
- Natural language processing on religious texts
- Multilingual research
- Islamic studies and education
- Translation studies

The data is provided in standard formats (CSV and JSON) that can be easily processed with common data analysis and NLP tools.

## Example Usage

### Python
```python
import pandas as pd

# Load a specific surah translation
surah_1 = pd.read_csv('en/english_saheeh/surah_001.csv')
print(surah_1.head())

# Load full translation for a language
full_en = pd.read_csv('en/full_language_translations.csv')
```

### JavaScript
```javascript
const fs = require('fs');

// Load translation metadata
const translationsIndex = JSON.parse(fs.readFileSync('translations_index.json', 'utf8'));
const translations = JSON.parse(fs.readFileSync('translations_list.json', 'utf8'));

// Get English translations
const englishTranslations = translations.filter(t => t.language_iso_code === 'en');
```

## Citation
If you use this dataset in your research or applications, please cite it appropriately.

## Sources 
Quran translations were taking from Quranenc.com Api 

