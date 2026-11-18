/**
 * The one fixed genre taxonomy, as data, and the function that collapses a messy tag onto it.
 *
 * Every genre and subgenre has a label (what is stored and shown) and a list of aliases (what other tools write for the
 * same thing: "Hip Hop/Rap", "rap", "hip-hop" are all Hip-Hop). The labels are the stored keys on a track's genre tags, so
 * a label is never renamed or reused, only added to. normalize() is pure and has no dependencies, so the browser and the
 * server use the same one.
 */

export interface SubgenreDef {
  label: string;
  aliases: string[];
}

export interface GenreDef {
  label: string;
  aliases: string[];
  subgenres: SubgenreDef[];
}

/** A node of the taxonomy: a genre, or a subgenre of one. */
export interface GenreNode {
  genre: string;
  subgenre?: string;
}

const sub = (label: string, ...aliases: string[]): SubgenreDef => ({ label, aliases });

export const GENRES: readonly GenreDef[] = [
  {
    label: "Hip-Hop",
    aliases: ["hip hop", "hiphop", "hip hop rap", "rap", "rap hip hop", "rap music", "hip hop music", "urban", "rap and hip hop", "hh"],
    subgenres: [
      sub("Trap", "trap music", "trap rap", "southern trap", "atlanta trap"),
      sub("Drill", "uk drill", "chicago drill", "ny drill", "brooklyn drill", "drill music"),
      sub("Boom Bap", "boombap", "east coast hip hop", "east coast rap", "golden age hip hop", "old school hip hop", "old school rap"),
      sub("Conscious", "conscious hip hop", "conscious rap", "political hip hop", "underground hip hop", "alternative hip hop", "alt hip hop"),
      sub("Gangsta Rap", "gangsta", "gangster rap", "g funk", "west coast hip hop", "west coast rap", "hardcore rap"),
      sub("Cloud Rap", "cloud rap music", "emo rap", "sad rap"),
      sub("Mumble Rap", "melodic rap", "melodic hip hop"),
      sub("Southern Hip-Hop", "dirty south", "southern rap", "crunk", "southern hip hop", "bounce"),
    ],
  },
  {
    label: "R&B",
    aliases: ["rnb", "r and b", "r n b", "rhythm and blues", "rhythm blues", "r b", "contemporary r and b", "urban contemporary", "rnb soul", "r and b soul"],
    subgenres: [
      sub("Contemporary R&B", "contemporary rnb", "modern r and b", "modern rnb", "mainstream r and b"),
      sub("Neo-Soul", "neo soul", "neosoul"),
      sub("Alternative R&B", "alt r and b", "alternative rnb", "alt rnb", "pbr and b"),
      sub("New Jack Swing", "njs", "new jack"),
      sub("Slow Jams", "slow jam", "quiet storm", "bedroom r and b", "love songs r and b"),
    ],
  },
  {
    label: "Pop",
    aliases: ["popular", "pop music", "top 40", "top40", "chart", "mainstream pop", "hits", "contemporary pop", "adult contemporary", "ac", "pop vocal"],
    subgenres: [
      sub("Dance Pop", "dance pop music", "pop dance", "club pop"),
      sub("Synth-Pop", "synthpop", "synth pop", "electropop", "electro pop", "futurepop"),
      sub("Indie Pop", "indiepop", "bedroom pop", "dream pop", "chamber pop"),
      sub("Teen Pop", "bubblegum pop", "bubblegum", "teen pop music"),
      sub("Pop Rap", "pop hip hop"),
      sub("Power Pop", "powerpop"),
    ],
  },
  {
    label: "Rock",
    aliases: ["rock music", "rock and roll", "rock n roll", "rock roll", "rocknroll", "classic rock", "guitar rock", "rock general", "pop rock", "soft rock"],
    subgenres: [
      sub("Classic Rock", "classic rock music", "70s rock", "60s rock", "oldies rock", "arena rock", "album rock", "aor"),
      sub("Hard Rock", "heavy rock", "hard rock music"),
      sub("Soft Rock", "light rock", "yacht rock", "soft rock music"),
      sub("Pop Rock", "pop rock music", "adult rock"),
      sub("Progressive Rock", "prog rock", "prog", "progressive", "art rock", "symphonic rock"),
      sub("Psychedelic Rock", "psychedelic", "psych rock", "psych", "acid rock", "psychedelia"),
      sub("Southern Rock", "southern rock music", "swamp rock"),
      sub("Glam Rock", "glam", "glam rock music"),
      sub("Rock & Roll", "rock and roll music", "50s rock", "rockabilly", "rock and roll oldies", "early rock and roll"),
    ],
  },
  {
    label: "Alternative",
    aliases: ["alternative rock", "alt rock", "alt", "alternative and punk", "alternative music", "modern rock", "college rock", "alternrock", "alternative indie"],
    subgenres: [
      sub("Indie", "indie rock", "indie music", "independent", "indie alternative", "lo fi indie"),
      sub("Grunge", "seattle sound", "grunge rock"),
      sub("Shoegaze", "shoegazing", "noise pop"),
      sub("Post-Punk", "post punk", "postpunk", "new wave revival", "dark wave rock"),
      sub("Emo", "emo rock", "midwest emo", "emocore", "screamo"),
      sub("Britpop", "brit pop", "british pop"),
      sub("New Wave", "newwave", "new wave music", "synth wave", "80s new wave"),
    ],
  },
  {
    label: "Electronic",
    aliases: ["electronica", "electro", "electronic music", "electronic dance", "electronic dance music", "edm", "dance", "dance music", "club", "club music", "idm", "synth", "electronic general"],
    subgenres: [
      sub("House", "house music", "chicago house", "classic house", "club house", "funky house", "vocal house", "soulful house"),
      sub("Deep House", "deephouse", "lounge house", "deep house music"),
      sub("Tech House", "techhouse", "tech-house", "tech house music"),
      sub("Progressive House", "prog house", "progressive house music"),
      sub("Techno", "techno music", "detroit techno", "minimal techno", "hard techno", "acid techno", "dub techno"),
      sub("Trance", "trance music", "progressive trance", "uplifting trance", "psytrance", "psy trance", "goa trance", "vocal trance"),
      sub("Drum & Bass", "drum and bass", "dnb", "d n b", "d and b", "drum n bass", "drum bass", "jungle", "liquid dnb", "neurofunk", "jump up"),
      sub("Dubstep", "dub step", "brostep", "riddim", "deep dubstep", "140"),
      sub("Future Bass", "futurebass", "melodic bass", "future bass music", "wave"),
      sub("Electro House", "electrohouse", "big room", "big room house", "bigroom", "festival house", "fidget house", "complextro"),
      sub("Ambient", "ambient music", "ambient electronic", "drone", "dark ambient", "chillout", "chill out", "downtempo", "trip hop", "triphop", "idm ambient"),
      sub("Lo-Fi", "lofi", "lo fi", "lofi hip hop", "lo fi hip hop", "chillhop", "lofi beats", "study beats", "chill beats"),
      sub("Synthwave", "synth wave electronic", "retrowave", "outrun", "vaporwave", "darksynth"),
      sub("Hardstyle", "hard style", "hardcore dance", "gabber", "hard dance", "happy hardcore"),
      sub("UK Garage", "uk garage music", "garage", "2 step", "2step", "speed garage", "grime", "bassline", "future garage"),
      sub("Breakbeat", "breaks", "big beat", "bigbeat", "breakbeat music", "nu skool breaks"),
      sub("Moombahton", "moombahcore", "moombah"),
    ],
  },
  {
    label: "Latin",
    aliases: ["latino", "latin music", "musica latina", "latin general", "latin urban", "latin american", "musica tropical", "tropical", "latina"],
    subgenres: [
      sub("Reggaeton", "reggaetón", "reguetón", "regueton", "reggaeton music", "perreo", "urbano latino", "latin trap"),
      sub("Salsa", "salsa music", "salsa dura", "salsa romantica", "mambo", "timba"),
      sub("Bachata", "bachata music", "bachata romantica", "dominican bachata"),
      sub("Merengue", "merengue music", "merengue tipico"),
      sub("Cumbia", "cumbia music", "cumbia villera", "colombian cumbia", "sonidera"),
      sub("Regional Mexican", "regional mexicano", "mexican", "mariachi", "banda", "norteno", "norteño", "ranchera", "corrido", "corridos tumbados", "musica mexicana", "tejano", "grupera", "duranguense"),
      sub("Latin Pop", "pop latino", "latin pop music", "pop en espanol", "spanish pop", "balada", "latin ballad"),
      sub("Bossa Nova", "bossa", "brazilian", "mpb", "samba", "brazilian music", "musica brasileira", "forro", "sertanejo", "pagode"),
      sub("Latin Urban", "urbano", "dembow", "latin hip hop", "rap latino", "trap latino", "latin trap music"),
    ],
  },
  {
    label: "Country",
    aliases: ["country music", "country and western", "country western", "country & western", "c and w", "nashville", "country general", "americana country", "honky tonk"],
    subgenres: [
      sub("Bluegrass", "bluegrass music", "newgrass", "progressive bluegrass"),
      sub("Outlaw Country", "outlaw", "outlaw country music", "red dirt"),
      sub("Country Pop", "country pop music", "pop country", "crossover country", "nashville pop"),
      sub("Country Rock", "country rock music", "southern country rock", "heartland rock"),
      sub("Alt-Country", "alt country", "alternative country", "americana", "country alternative", "roots rock", "insurgent country"),
      sub("Bro-Country", "bro country", "country trap", "hick hop"),
      sub("Traditional Country", "classic country", "old country", "honky-tonk", "traditional country music", "western swing"),
    ],
  },
  {
    label: "Jazz",
    aliases: ["jazz music", "jazz general", "jazzy", "contemporary jazz", "swing jazz", "vocal jazz", "jazz vocal"],
    subgenres: [
      sub("Smooth Jazz", "smooth", "smoothjazz", "contemporary instrumental", "easy jazz"),
      sub("Bebop", "be bop", "bop", "hard bop", "hardbop", "post bop"),
      sub("Swing", "big band", "swing music", "big band swing", "swing era", "dixieland"),
      sub("Fusion", "jazz fusion", "jazz rock", "jazz funk", "jazz+funk", "acid jazz", "nu jazz"),
      sub("Latin Jazz", "afro cuban jazz", "latin jazz music", "afro-cuban"),
      sub("Cool Jazz", "cool", "west coast jazz", "modal jazz", "modal"),
      sub("Vocal Jazz", "jazz singers", "jazz standards", "traditional pop", "standards", "great american songbook"),
    ],
  },
  {
    label: "Blues",
    aliases: ["blues music", "the blues", "blues general", "electric blues", "chicago blues"],
    subgenres: [
      sub("Delta Blues", "country blues", "acoustic blues", "mississippi blues", "piedmont blues"),
      sub("Blues Rock", "blues-rock", "bluesrock", "electric blues rock"),
      sub("Soul Blues", "r and b blues", "southern soul blues", "memphis blues", "texas blues"),
    ],
  },
  {
    label: "Gospel",
    aliases: ["gospel music", "christian", "christian music", "gospel and christian", "gospel christian", "christian and gospel", "ccm", "contemporary christian", "contemporary christian music", "worship", "praise and worship", "praise worship", "inspirational", "religious", "spiritual", "sacred", "church"],
    subgenres: [
      sub("Contemporary Gospel", "urban gospel", "modern gospel", "gospel r and b"),
      sub("Traditional Gospel", "southern gospel", "black gospel", "classic gospel", "gospel quartet", "negro spiritual"),
      sub("Praise & Worship", "praise and worship music", "worship music", "christian worship", "church worship", "worship songs"),
      sub("Christian Hip-Hop", "christian rap", "christian hip hop", "gospel rap", "holy hip hop"),
      sub("Christian Rock", "christian rock music", "christian alternative", "christian pop"),
    ],
  },
  {
    label: "Reggae/Dancehall",
    aliases: ["reggae", "dancehall", "reggae dancehall", "reggae and dancehall", "dancehall reggae", "jamaican", "jamaican music", "caribbean", "dancehall music", "reggae music", "ragga", "raggamuffin", "riddim music"],
    subgenres: [
      sub("Roots Reggae", "roots reggae music", "classic reggae", "one drop", "rastafari"),
      sub("Dancehall", "modern dancehall", "dancehall pop", "ragga dancehall"),
      sub("Dub", "dub reggae", "dub music", "dub poetry"),
      sub("Ska", "ska music", "rocksteady", "two tone", "2 tone"),
      sub("Reggae Fusion", "reggae pop", "pop reggae", "reggae rock", "lovers rock", "lover's rock", "reggae fusion music"),
      sub("Soca", "soca music", "calypso", "chutney soca", "power soca", "groovy soca"),
    ],
  },
  {
    label: "Afrobeats",
    aliases: ["afrobeat", "afro beats", "afro pop", "afropop", "african", "african music", "afrobeats music", "naija", "naija pop", "nigerian pop", "afro", "afro fusion", "afrofusion", "world african"],
    subgenres: [
      sub("Amapiano", "amapiano music", "south african house", "gqom", "kwaito"),
      sub("Afrobeat", "fela", "afrobeat music", "highlife", "afro funk", "afrofunk", "juju"),
      sub("Afro-House", "afro house", "afrohouse", "afro tech", "afro deep"),
      sub("Afro-Fusion", "afro fusion music", "alte", "afro r and b", "afro soul"),
      sub("Azonto", "azonto music", "hiplife", "ghana hiplife", "afro hip hop", "afro trap"),
    ],
  },
  {
    label: "Classical",
    aliases: ["classical music", "classic", "orchestral", "orchestra", "symphony", "symphonic", "baroque", "romantic", "classical general", "chamber music", "opera", "choral", "classical crossover", "contemporary classical", "modern classical"],
    subgenres: [
      sub("Baroque", "baroque music", "baroque era", "early music", "renaissance"),
      sub("Romantic", "romantic era", "romantic music", "late romantic"),
      sub("Opera", "opera music", "operatic", "aria", "vocal classical", "lieder"),
      sub("Chamber", "chamber music classical", "string quartet", "piano trio", "chamber classical"),
      sub("Piano", "solo piano", "piano classical", "classical piano", "piano music"),
      sub("Contemporary Classical", "minimalism", "minimalist", "neoclassical", "neo classical", "post classical", "modern classical music", "modern composition"),
    ],
  },
  {
    label: "Soundtrack",
    aliases: ["soundtracks", "ost", "o s t", "original soundtrack", "film score", "movie score", "film music", "movie soundtrack", "movie music", "score", "tv soundtrack", "tv score", "video game music", "game soundtrack", "vgm", "game music", "film", "movie", "trailer music", "cinematic", "anime", "anime soundtrack", "musical", "musicals", "showtunes", "show tunes", "broadway", "stage and screen", "disney"],
    subgenres: [
      sub("Film Score", "film scores", "movie scores", "cinematic score", "orchestral score", "epic", "epic music", "trailer", "trailers", "trailer music score"),
      sub("Video Game", "video game soundtrack", "game ost", "chiptune", "8 bit", "8bit", "game score"),
      sub("Musical Theatre", "musical theater", "musical theatre music", "cast recording", "original cast", "stage"),
      sub("TV Themes", "tv themes", "tv theme", "tv music", "television", "television themes", "theme songs", "theme song"),
      sub("Anime", "anime music", "anime ost", "j anime", "anisong", "anime songs"),
    ],
  },
  {
    label: "Metal",
    aliases: ["heavy metal", "metal music", "hard and heavy", "metalcore", "nu metal", "numetal", "thrash", "thrash metal", "death metal", "black metal", "doom metal", "power metal", "metal general", "heavy"],
    subgenres: [
      sub("Thrash Metal", "thrash", "thrash metal music", "bay area thrash"),
      sub("Death Metal", "death metal music", "melodic death metal", "brutal death metal", "deathcore", "death"),
      sub("Black Metal", "black metal music", "symphonic black metal", "blackened"),
      sub("Doom Metal", "doom", "stoner", "stoner metal", "stoner rock", "sludge", "sludge metal", "drone metal"),
      sub("Nu Metal", "numetal", "nu-metal", "nu metal music", "rap metal", "alternative metal", "industrial metal"),
      sub("Metalcore", "metalcore music", "hardcore metal", "post hardcore", "post-hardcore"),
      sub("Power Metal", "power metal music", "symphonic metal", "melodic metal", "epic metal", "heavy metal classic", "nwobhm", "glam metal", "hair metal"),
    ],
  },
  {
    label: "Punk",
    aliases: ["punk rock", "punk music", "punk general", "hardcore punk", "hardcore", "pop punk", "pop-punk", "poppunk", "oi", "street punk", "anarcho punk", "skate punk"],
    subgenres: [
      sub("Pop Punk", "pop-punk", "poppunk", "pop punk music", "easycore", "emo pop punk"),
      sub("Hardcore", "hardcore punk", "hc punk", "hardcore music", "straight edge", "thrashcore"),
      sub("Classic Punk", "70s punk", "1977 punk", "original punk", "proto punk", "protopunk", "garage punk", "garage rock"),
      sub("Skate Punk", "skatepunk", "melodic hardcore", "melodic punk", "california punk", "nofx"),
      sub("Ska Punk", "skacore", "third wave ska", "ska-punk"),
    ],
  },
  {
    label: "Folk",
    aliases: ["folk music", "acoustic", "singer songwriter", "singer/songwriter", "singer-songwriter", "songwriter", "folk rock", "folk-rock", "contemporary folk", "traditional folk", "folk general", "celtic", "irish", "irish folk", "indie folk", "acoustic pop", "unplugged"],
    subgenres: [
      sub("Singer-Songwriter", "singer songwriter", "singer/songwriter", "songwriter", "acoustic singer songwriter", "confessional"),
      sub("Folk Rock", "folk-rock", "folk rock music", "electric folk", "country folk"),
      sub("Indie Folk", "indie folk music", "freak folk", "anti folk", "antifolk", "neo folk", "chamber folk", "stomp and holler"),
      sub("Celtic", "celtic music", "irish folk", "irish music", "scottish folk", "celtic folk", "gaelic", "celtic rock"),
      sub("Traditional Folk", "old time", "oldtime", "appalachian", "american folk", "english folk", "folk revival", "world folk"),
    ],
  },
  {
    label: "Soul",
    aliases: ["soul music", "classic soul", "northern soul", "southern soul", "motown", "memphis soul", "philly soul", "philadelphia soul", "deep soul", "retro soul", "soul general", "soul and r and b"],
    subgenres: [
      sub("Motown", "motown sound", "motown soul", "detroit soul", "the motown sound", "sound of young america"),
      sub("Northern Soul", "northern soul music", "uptempo soul", "rare soul"),
      sub("Southern Soul", "stax", "memphis soul music", "muscle shoals", "deep southern soul", "chitlin circuit"),
      sub("Blue-Eyed Soul", "blue eyed soul", "white soul", "blue eyed", "blue-eyed"),
    ],
  },
  {
    label: "Funk",
    aliases: ["funk music", "funky", "funk general", "p funk", "p-funk", "parliament funkadelic", "go go", "gogo", "go-go", "funk soul", "funk and soul", "boogie", "electro funk", "electrofunk", "future funk", "synth funk", "nu funk", "funk rock", "funk metal"],
    subgenres: [
      sub("P-Funk", "p funk", "parliament", "funkadelic", "george clinton"),
      sub("Go-Go", "go go", "gogo", "dc go go", "washington go go"),
      sub("Boogie", "post disco", "post-disco", "boogie funk", "modern boogie", "electro boogie"),
      sub("Funk Rock", "funk metal", "funk-rock", "funk rock music", "alternative funk"),
      sub("Nu-Funk", "nu funk", "future funk", "neo funk", "new funk", "jazz funk groove"),
    ],
  },
  {
    label: "Disco",
    aliases: ["disco music", "70s disco", "disco funk", "euro disco", "eurodisco", "italo disco", "italo", "nu disco", "nu-disco", "nudisco", "disco general", "hi nrg", "hi-nrg", "hinrg", "disco house", "dancefloor"],
    subgenres: [
      sub("Nu-Disco", "nu disco", "nudisco", "indie dance", "disco revival", "neo disco", "modern disco", "space disco"),
      sub("Italo Disco", "italo", "italo-disco", "italodisco", "euro italo", "italo dance"),
      sub("Eurodisco", "euro disco", "euro-disco", "eurodisco music", "euro dance disco", "eurobeat"),
      sub("Hi-NRG", "hi nrg", "hinrg", "high energy", "high-energy", "high energy disco", "hi energy"),
      sub("Classic Disco", "70s disco", "studio 54", "disco classics", "disco era", "philly disco", "boogie disco"),
    ],
  },
  {
    label: "World",
    aliases: ["world music", "worldbeat", "world beat", "international", "ethnic", "world general", "global", "folk world", "world fusion", "world pop", "k pop", "kpop", "k-pop", "j pop", "jpop", "j-pop", "c pop", "cpop", "bollywood", "indian", "desi", "arabic", "middle eastern", "turkish", "greek", "klezmer", "polka", "fado", "flamenco", "balkan", "caribbean world", "asian", "asian pop", "korean", "japanese", "chinese", "hindi", "punjabi", "bhangra"],
    subgenres: [
      sub("K-Pop", "kpop", "k pop", "korean pop", "korean music", "korean", "k hip hop", "k-hip hop", "korean hip hop", "k r and b", "k-rock"),
      sub("J-Pop", "jpop", "j pop", "japanese pop", "japanese music", "japanese", "city pop", "j rock", "jrock", "j-rock", "visual kei", "shibuya kei"),
      sub("Bollywood", "bollywood music", "hindi film", "indian film music", "indian pop", "hindi pop", "hindi", "indian", "desi", "filmi", "tollywood", "indi pop"),
      sub("Bhangra", "punjabi", "punjabi pop", "bhangra music", "desi hip hop", "punjabi hip hop"),
      sub("Arabic", "arabic pop", "arab pop", "middle eastern", "khaleeji", "raï", "rai", "arabic music", "turkish pop", "turkish", "persian"),
      sub("Flamenco", "flamenco music", "flamenco pop", "gypsy", "gypsy kings", "rumba flamenca", "spanish guitar", "fado", "portuguese"),
      sub("C-Pop", "cpop", "c pop", "chinese pop", "mandopop", "cantopop", "chinese", "taiwanese pop", "c-rock"),
    ],
  },
  {
    label: "Holiday",
    aliases: ["holiday music", "holidays", "seasonal", "christmas", "xmas", "christmas music", "christmas songs", "holiday christmas", "christmas carols", "carols", "hanukkah", "kwanzaa", "winter", "halloween", "halloween music", "spooky", "spooky music", "horror", "monster mash", "thanksgiving", "easter", "valentines", "valentine", "new years", "new year", "fourth of july"],
    subgenres: [
      sub("Christmas", "xmas", "christmas music", "christmas songs", "christmas carols", "carols", "christmas pop", "christmas classics", "christmas holiday", "noel", "yule", "yuletide", "santa", "winter holiday"),
      sub("Halloween", "halloween music", "spooky", "spooky music", "horror", "monster mash", "halloween songs", "scary", "creepy", "witchy", "haunted", "haunted house", "monsters"),
      sub("Hanukkah", "chanukah", "hanukah", "chanukkah", "jewish holiday", "hanukkah music", "chanukah music"),
      sub("Other Holidays", "thanksgiving", "easter", "valentines", "valentine", "new years", "new year", "fourth of july", "july 4th", "independence day", "st patricks day", "st paddys", "mothers day", "fathers day"),
    ],
  },
  {
    label: "Children's",
    aliases: ["childrens", "children", "kids", "kid", "kids music", "children's music", "childrens music", "nursery", "nursery rhymes", "lullaby", "lullabies", "baby", "baby music", "family", "kindermusik", "toddler", "preschool", "sing along kids", "disney kids", "kids pop", "kidz bop", "kidzbop"],
    subgenres: [
      sub("Nursery Rhymes", "nursery rhyme", "nursery songs", "mother goose", "rhymes", "kids songs", "kids classics", "action songs", "counting songs", "abc songs"),
      sub("Lullabies", "lullaby", "bedtime", "bedtime songs", "sleep music", "sleep", "baby sleep", "baby lullaby", "soothing", "calming"),
      sub("Kids Pop", "kidz bop", "kidzbop", "kids pop music", "kids covers", "disney kids", "family pop", "kids dance", "kids hip hop", "kid friendly"),
      sub("Story & Educational", "educational", "learning", "audiobook kids", "kids stories", "school songs", "sesame street", "veggietales", "story songs"),
    ],
  },
  {
    label: "Spoken Word",
    aliases: ["spoken", "spoken word music", "speech", "audiobook", "audio book", "audiobooks", "podcast", "podcasts", "comedy", "stand up", "stand-up", "standup", "poetry", "spoken word poetry", "poetry slam", "interview", "lecture", "radio", "radio show", "talk", "talk radio", "news", "sermon", "sermons", "monologue", "storytelling", "story"],
    subgenres: [
      sub("Comedy", "stand up", "stand-up", "standup", "stand up comedy", "comedy music", "comedy album", "humor", "humour", "parody", "novelty", "novelty songs", "funny", "comic", "satire", "sketch"),
      sub("Poetry", "spoken word poetry", "poetry slam", "slam poetry", "poems", "poem", "poetry reading", "beat poetry", "performance poetry"),
      sub("Audiobook", "audio book", "audiobooks", "audio books", "book", "books", "reading", "novel reading", "narration", "narrated", "story reading"),
      sub("Podcast", "podcasts", "talk", "talk radio", "radio", "radio show", "interview", "interviews", "lecture", "lectures", "speech", "speeches", "sermon", "sermons", "news"),
    ],
  },
  {
    label: "Easy Listening",
    aliases: ["easy", "lounge", "lounge music", "exotica", "easy listening music", "elevator music", "muzak", "background music", "bossa lounge", "cocktail", "cocktail music", "chill lounge", "mellow", "relaxing", "relaxation", "new age", "new age music", "meditation", "meditative", "healing", "spa", "yoga", "zen", "nature sounds", "nature", "white noise", "sleep sounds", "mood music", "adult standards", "oldies", "vocal pop", "crooner", "crooners", "vocal", "vocals", "standards pop", "retro", "nostalgia"],
    subgenres: [
      sub("Lounge", "lounge music", "cocktail", "cocktail music", "exotica", "tiki", "space age pop", "bachelor pad", "martini", "chill lounge", "bossa lounge", "hotel lounge", "easy lounge"),
      sub("New Age", "new age music", "newage", "healing", "spa", "yoga", "zen", "meditation", "meditative", "relaxation", "relaxing", "mindfulness", "spiritual new age", "celtic new age"),
      sub("Oldies", "oldies but goodies", "golden oldies", "50s", "60s", "50s pop", "60s pop", "retro", "nostalgia", "doo wop", "doowop", "vintage pop", "vintage", "yesteryear"),
      sub("Crooners", "crooner", "vocal pop", "vocal", "vocals", "adult standards", "standards pop", "rat pack", "sinatra", "traditional vocal pop", "easy vocal", "tin pan alley"),
      sub("Nature Sounds", "nature", "nature sounds", "white noise", "sleep sounds", "rain", "rain sounds", "ocean", "ocean sounds", "forest", "ambient nature", "field recording", "field recordings", "soundscape", "soundscapes"),
    ],
  },
];

/** A name reduced to its comparable form: lowercase, no accents, "&" as "and", every other symbol a space, spaces collapsed. */
export function aliasKey(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface Lookup {
  node: GenreNode;
  /** Lower wins: a genre's label, then a subgenre's label, then a subgenre's alias, then a genre's alias (so the more specific reading of a name wins within a genre). */
  rank: number;
}

const GENRE_LABELS: readonly string[] = GENRES.map((g) => g.label);

/** Every alias key to the node it means. When two entries claim a key, the stronger claim (a label over an alias, a genre over a subgenre) wins. */
const LOOKUP: ReadonlyMap<string, GenreNode> = (() => {
  const map = new Map<string, Lookup>();
  const claim = (name: string, node: GenreNode, rank: number) => {
    const key = aliasKey(name);
    if (!key) return;
    const have = map.get(key);
    if (!have || rank < have.rank) map.set(key, { node, rank });
  };
  for (const g of GENRES) {
    claim(g.label, { genre: g.label }, 0);
    for (const a of g.aliases) claim(a, { genre: g.label }, 3);
  }
  for (const g of GENRES) {
    for (const s of g.subgenres) {
      claim(s.label, { genre: g.label, subgenre: s.label }, 1);
      for (const a of s.aliases) claim(a, { genre: g.label, subgenre: s.label }, 2);
    }
  }
  return new Map([...map].map(([k, v]) => [k, v.node]));
})();

/** The ID3v1 genre numbers files carry as "(17)" or "17", for the ones that name something on the taxonomy. */
const ID3V1: Readonly<Record<number, GenreNode>> = {
  0: { genre: "Blues" },
  1: { genre: "Rock", subgenre: "Classic Rock" },
  2: { genre: "Country" },
  3: { genre: "Electronic" },
  4: { genre: "Disco" },
  5: { genre: "Funk" },
  6: { genre: "Alternative", subgenre: "Grunge" },
  7: { genre: "Hip-Hop" },
  8: { genre: "Jazz" },
  9: { genre: "Metal" },
  10: { genre: "Easy Listening", subgenre: "New Age" },
  11: { genre: "Easy Listening", subgenre: "Oldies" },
  13: { genre: "Pop" },
  14: { genre: "R&B" },
  15: { genre: "Hip-Hop" },
  16: { genre: "Reggae/Dancehall" },
  17: { genre: "Rock" },
  18: { genre: "Electronic", subgenre: "Techno" },
  20: { genre: "Alternative" },
  21: { genre: "Reggae/Dancehall", subgenre: "Ska" },
  22: { genre: "Metal", subgenre: "Death Metal" },
  24: { genre: "Soundtrack" },
  26: { genre: "Electronic", subgenre: "Ambient" },
  27: { genre: "Electronic", subgenre: "Ambient" },
  31: { genre: "Electronic", subgenre: "Trance" },
  32: { genre: "Classical" },
  35: { genre: "Electronic", subgenre: "House" },
  38: { genre: "Gospel" },
  40: { genre: "Alternative" },
  42: { genre: "Soul" },
  43: { genre: "Punk" },
  52: { genre: "Electronic" },
  57: { genre: "Spoken Word", subgenre: "Comedy" },
  59: { genre: "Hip-Hop", subgenre: "Gangsta Rap" },
  61: { genre: "Gospel", subgenre: "Christian Hip-Hop" },
  63: { genre: "Electronic", subgenre: "Drum & Bass" },
  66: { genre: "Alternative", subgenre: "New Wave" },
  67: { genre: "Rock", subgenre: "Psychedelic Rock" },
  69: { genre: "Soundtrack", subgenre: "Musical Theatre" },
  71: { genre: "Electronic", subgenre: "Lo-Fi" },
  74: { genre: "Jazz", subgenre: "Fusion" },
  77: { genre: "Soundtrack", subgenre: "Musical Theatre" },
  78: { genre: "Rock", subgenre: "Rock & Roll" },
  79: { genre: "Rock", subgenre: "Hard Rock" },
};

/** A tag that says nothing about genre. */
const NO_GENRE = new Set(["", "other", "unknown", "genre", "none", "n a", "na", "misc", "miscellaneous", "various", "undefined", "null", "music", "untitled", "unclassifiable", "blank", "tbd", "test"]);

/** Wrappers the same tag arrives in: "(17)Rock", "[Hip Hop]", "Genre: Rock", "Trap Music", "Rock genre". */
function variants(key: string): string[] {
  const out = [key];
  const trim = (s: string) => s.replace(/\s+/g, " ").trim();
  const prefix = key.replace(/^(genre|style|category|type) /, "");
  if (prefix !== key) out.push(trim(prefix));
  const suffixed = key.replace(/ (music|genre|style|songs)$/, "");
  if (suffixed !== key) out.push(trim(suffixed));
  const middle = key.replace(/ (music|genre|style) /g, " ");
  if (middle !== key) out.push(trim(middle));
  const article = key.replace(/^(the|a) /, "");
  if (article !== key) out.push(trim(article));
  return out;
}

/**
 * Collapses one messy tag onto the taxonomy: a genre, a subgenre of one, or null when the tag names neither (a year, "seen
 * live", "Other", an empty string, a genre this taxonomy does not have). A tag that holds several genres ("Rock/Pop") is
 * not split here: it is only an exact alias if the taxonomy says so; use normalizeMany() to split it.
 */
export function normalize(rawTag: string | null | undefined): GenreNode | null {
  if (typeof rawTag !== "string") return null;
  const id3 = /^\s*[([]?\s*(\d{1,3})\s*[)\]]?\s*$/.exec(rawTag);
  if (id3) return ID3V1[Number(id3[1])] ?? null;
  // "(17)Rock" or "(13)" followed by text: the text is the better source.
  const wrapped = /^\s*\(\d{1,3}\)\s*(.+)$/.exec(rawTag);
  const key = aliasKey(wrapped ? wrapped[1] : rawTag);
  if (NO_GENRE.has(key) || key.length > 60) return null;
  for (const v of variants(key)) {
    const hit = LOOKUP.get(v);
    if (hit) return { ...hit };
  }
  return null;
}

/** Tag separators for a value that lists several genres. A "/" or "+" inside a name is tried whole first (see normalizeMany). */
const SEPARATORS = /\s*(?:[;,|\\/]|\s\+\s|\s-\s|\s•\s)\s*/;

/** normalize() for a tag that may hold several genres ("Rock; Pop", "Hip-Hop/Rap, R&B"): the whole tag if it is one alias, else each part. No duplicates. */
export function normalizeMany(rawTag: string | null | undefined): GenreNode[] {
  if (typeof rawTag !== "string") return [];
  const whole = normalize(rawTag);
  if (whole) return [whole];
  const out: GenreNode[] = [];
  const seen = new Set<string>();
  for (const part of rawTag.split(SEPARATORS)) {
    const node = normalize(part);
    if (!node) continue;
    const id = `${node.genre}/${node.subgenre ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(node);
  }
  return out;
}

/** The genre node for a stored label pair, or null if the pair is not on the taxonomy (a stale or hand-edited value). */
export function findNode(genre: string, subgenre?: string | null): GenreNode | null {
  const def = GENRES.find((g) => g.label === genre);
  if (!def) return null;
  if (!subgenre) return { genre: def.label };
  const s = def.subgenres.find((x) => x.label === subgenre);
  return s ? { genre: def.label, subgenre: s.label } : null;
}

/** Whether a stored genre (and subgenre) is on the taxonomy. */
export function isTaxonomyNode(genre: string, subgenre?: string | null): boolean {
  return findNode(genre, subgenre) != null;
}

export function genreLabels(): readonly string[] {
  return GENRE_LABELS;
}

export function subgenreLabels(genre: string): string[] {
  return GENRES.find((g) => g.label === genre)?.subgenres.map((s) => s.label) ?? [];
}
