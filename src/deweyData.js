// The Dewey Decimal Classification's real second-summary table: the 10
// main classes (multiples of 100) and their 100 divisions (multiples of
// 10) exactly as published by OCLC/library systems worldwide — not a
// simplified or invented stand-in. Kept at the division level (not the
// full ~1,000 three-digit sections, and not the further decimal
// subdivisions) so every number and name here is one we can vouch for as
// the real, standard classification, rather than guessing at finer
// subject numbers from memory.
//
// `keywords` are search-only synonyms (genres/subjects a person might
// actually type) added on top of the real official caption, so "cooking"
// or "dinosaurs" still finds the right division even though the official
// caption says "Home & family management" or "Fossils & prehistoric life."
export const DEWEY_MAIN_CLASSES = [
  { code: "000", name: "Computer science, information & general works" },
  { code: "100", name: "Philosophy & psychology" },
  { code: "200", name: "Religion" },
  { code: "300", name: "Social sciences" },
  { code: "400", name: "Language" },
  { code: "500", name: "Science" },
  { code: "600", name: "Technology" },
  { code: "700", name: "Arts & recreation" },
  { code: "800", name: "Literature" },
  { code: "900", name: "History & geography" },
];

export const DEWEY_DIVISIONS = [
  { code: "000", name: "Computer science, knowledge & systems", keywords: ["computers", "software", "internet", "data"] },
  { code: "010", name: "Bibliographies", keywords: ["catalogs"] },
  { code: "020", name: "Library & information sciences", keywords: ["libraries", "archives"] },
  { code: "030", name: "Encyclopedias & books of facts", keywords: ["trivia", "reference"] },
  { code: "040", name: "[Unassigned]", keywords: [] },
  { code: "050", name: "Magazines, journals & serials", keywords: ["periodicals"] },
  { code: "060", name: "Associations, organizations & museums", keywords: ["clubs", "societies"] },
  { code: "070", name: "News media, journalism & publishing", keywords: ["newspapers", "reporting"] },
  { code: "080", name: "Quotations", keywords: ["quotes", "sayings"] },
  { code: "090", name: "Manuscripts & rare books", keywords: ["antiquarian"] },

  { code: "100", name: "Philosophy", keywords: ["reasoning", "existence"] },
  { code: "110", name: "Metaphysics", keywords: ["reality", "being"] },
  { code: "120", name: "Epistemology", keywords: ["knowledge", "causation"] },
  { code: "130", name: "Parapsychology & occultism", keywords: ["astrology", "psychics", "the paranormal", "tarot"] },
  { code: "140", name: "Philosophical schools of thought", keywords: [] },
  { code: "150", name: "Psychology", keywords: ["the mind", "behavior", "self-help"] },
  { code: "160", name: "Logic", keywords: ["argumentation"] },
  { code: "170", name: "Ethics", keywords: ["morality", "right and wrong"] },
  { code: "180", name: "Ancient, medieval & eastern philosophy", keywords: ["confucius", "buddhism as philosophy"] },
  { code: "190", name: "Modern western philosophy", keywords: [] },

  { code: "200", name: "Religion", keywords: ["theology", "spirituality", "faith"] },
  { code: "210", name: "Philosophy & theory of religion", keywords: ["god", "existence of god"] },
  { code: "220", name: "The Bible", keywords: ["scripture", "old testament", "new testament"] },
  { code: "230", name: "Christianity & Christian theology", keywords: [] },
  { code: "240", name: "Christian practice & observance", keywords: ["prayer", "devotionals"] },
  { code: "250", name: "Christian pastoral practice & religious orders", keywords: ["clergy", "monks", "nuns"] },
  { code: "260", name: "Christian organization, social work & worship", keywords: ["church", "sacraments"] },
  { code: "270", name: "History of Christianity", keywords: [] },
  { code: "280", name: "Christian denominations", keywords: ["catholicism", "protestantism", "orthodoxy"] },
  { code: "290", name: "Other religions", keywords: ["islam", "judaism", "hinduism", "buddhism", "mythology"] },

  { code: "300", name: "Social sciences, sociology & anthropology", keywords: ["society", "culture"] },
  { code: "310", name: "Statistics", keywords: ["data analysis", "surveys"] },
  { code: "320", name: "Political science", keywords: ["politics", "government", "elections"] },
  { code: "330", name: "Economics", keywords: ["money", "finance", "business cycles", "investing"] },
  { code: "340", name: "Law", keywords: ["legal", "constitutions", "crime and law"] },
  { code: "350", name: "Public administration & military science", keywords: ["the military", "armed forces", "war strategy"] },
  { code: "360", name: "Social problems & social services", keywords: ["criminology", "true crime", "welfare", "social work"] },
  { code: "370", name: "Education", keywords: ["schools", "teaching", "pedagogy"] },
  { code: "380", name: "Commerce, communications & transportation", keywords: ["trade", "shipping", "railroads"] },
  { code: "390", name: "Customs, etiquette & folklore", keywords: ["manners", "fairy tales", "legends", "traditions"] },

  { code: "400", name: "Language", keywords: ["linguistics", "grammar", "languages"] },
  { code: "410", name: "Linguistics", keywords: ["phonetics", "syntax"] },
  { code: "420", name: "English & Old English languages", keywords: [] },
  { code: "430", name: "German & related languages", keywords: ["dutch", "yiddish"] },
  { code: "440", name: "French & related languages", keywords: [] },
  { code: "450", name: "Italian, Romanian & related languages", keywords: [] },
  { code: "460", name: "Spanish & Portuguese languages", keywords: [] },
  { code: "470", name: "Latin & Italic languages", keywords: [] },
  { code: "480", name: "Classical & modern Greek languages", keywords: [] },
  { code: "490", name: "Other languages", keywords: ["arabic", "chinese", "japanese", "russian"] },

  { code: "500", name: "Science", keywords: ["natural science"] },
  { code: "510", name: "Mathematics", keywords: ["math", "algebra", "geometry", "calculus", "arithmetic"] },
  { code: "520", name: "Astronomy", keywords: ["space", "planets", "stars", "the solar system"] },
  { code: "530", name: "Physics", keywords: ["mechanics", "energy", "quantum physics"] },
  { code: "540", name: "Chemistry", keywords: ["chemicals", "reactions", "the periodic table"] },
  { code: "550", name: "Earth sciences & geology", keywords: ["rocks", "minerals", "volcanoes", "earthquakes", "weather", "climate"] },
  { code: "560", name: "Fossils & prehistoric life", keywords: ["dinosaurs", "paleontology"] },
  { code: "570", name: "Life sciences; biology", keywords: ["genetics", "evolution", "microbiology", "cells"] },
  { code: "580", name: "Plants (Botany)", keywords: ["gardening", "flowers", "trees"] },
  { code: "590", name: "Animals (Zoology)", keywords: ["pets", "wildlife", "insects", "dogs", "cats", "birds"] },

  { code: "600", name: "Technology", keywords: ["applied science", "engineering"] },
  { code: "610", name: "Medicine & health", keywords: ["nursing", "diseases", "anatomy", "nutrition"] },
  { code: "620", name: "Engineering", keywords: ["mechanical engineering", "electrical engineering", "civil engineering"] },
  { code: "630", name: "Agriculture", keywords: ["farming", "livestock", "crops"] },
  { code: "640", name: "Home & family management", keywords: ["cooking", "recipes", "food", "sewing", "housekeeping"] },
  { code: "650", name: "Management & public relations", keywords: ["business management", "advertising", "careers"] },
  { code: "660", name: "Chemical engineering", keywords: ["industrial chemistry"] },
  { code: "670", name: "Manufacturing", keywords: ["factories", "industrial processes"] },
  { code: "680", name: "Manufacture for specific uses", keywords: ["woodworking", "leatherwork"] },
  { code: "690", name: "Building & construction", keywords: ["carpentry", "architecture construction"] },

  { code: "700", name: "Arts", keywords: ["the arts"] },
  { code: "710", name: "Landscaping & area planning", keywords: ["urban planning", "parks"] },
  { code: "720", name: "Architecture", keywords: ["buildings design"] },
  { code: "730", name: "Sculpture, ceramics & metalwork", keywords: ["pottery"] },
  { code: "740", name: "Drawing & decorative arts", keywords: ["cartooning", "comics", "illustration"] },
  { code: "750", name: "Painting", keywords: ["paintings", "watercolor"] },
  { code: "760", name: "Graphic arts", keywords: ["printmaking"] },
  { code: "770", name: "Photography & computer art", keywords: ["photos", "digital art"] },
  { code: "780", name: "Music", keywords: ["songs", "instruments", "composers"] },
  { code: "790", name: "Sports, games & entertainment", keywords: ["sports", "games", "hobbies", "movies", "film", "tv"] },

  { code: "800", name: "Literature", keywords: ["books", "fiction", "poetry", "plays", "novels", "essays"] },
  { code: "810", name: "American literature in English", keywords: ["american fiction", "american poetry"] },
  { code: "820", name: "English & Old English literatures", keywords: ["british literature", "shakespeare"] },
  { code: "830", name: "German & related literatures", keywords: [] },
  { code: "840", name: "French & related literatures", keywords: [] },
  { code: "850", name: "Italian, Romanian & related literatures", keywords: [] },
  { code: "860", name: "Spanish & Portuguese literatures", keywords: [] },
  { code: "870", name: "Latin & Italic literatures", keywords: ["classical literature"] },
  { code: "880", name: "Classical & modern Greek literatures", keywords: ["greek myths as literature"] },
  { code: "890", name: "Other literatures", keywords: [] },

  { code: "900", name: "History & geography", keywords: ["history", "geography"] },
  { code: "910", name: "Geography & travel", keywords: ["maps", "atlases", "travel guides"] },
  { code: "920", name: "Biography & genealogy", keywords: ["biographies", "memoirs", "family history"] },
  { code: "930", name: "History of ancient world (to ca. 499)", keywords: ["ancient rome", "ancient greece", "ancient egypt"] },
  { code: "940", name: "History of Europe", keywords: ["world war", "european history"] },
  { code: "950", name: "History of Asia", keywords: ["chinese history", "japanese history"] },
  { code: "960", name: "History of Africa", keywords: ["african history"] },
  { code: "970", name: "History of North America", keywords: ["american history", "u.s. history", "canadian history"] },
  { code: "980", name: "History of South America", keywords: ["latin american history"] },
  { code: "990", name: "History of other areas", keywords: ["australian history", "pacific islands", "antarctica"] },
];
