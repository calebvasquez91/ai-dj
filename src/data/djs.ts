/**
 * Reference set of widely-known DJs, grouped loosely by the scene they're
 * best known for. `signatureStyle` is a short, general characterization
 * based on public reputation, not a biography — useful as inspiration
 * copy, not a factual record.
 */

export interface DjEntry {
  name: string;
  genres: string[];
  era: string;
  signatureStyle: string;
}

export const djs: DjEntry[] = [
  // Pioneers & old-school legends
  { name: "Kool Herc", genres: ["hip-hop"], era: "1970s (pioneer)", signatureStyle: "Credited with originating hip-hop DJing via extended breakbeats." },
  { name: "Grandmaster Flash", genres: ["hip-hop"], era: "1970s-1980s (pioneer)", signatureStyle: "Pioneered quick-mix theory, cutting, and backspinning." },
  { name: "Grand Wizzard Theodore", genres: ["hip-hop"], era: "1970s-1980s (pioneer)", signatureStyle: "Credited with inventing the scratch technique." },
  { name: "Afrika Bambaataa", genres: ["hip-hop", "electro"], era: "1970s-1980s (pioneer)", signatureStyle: "Eclectic crate-digging that fused funk, rock, and electro into hip-hop." },
  { name: "Larry Levan", genres: ["disco", "house"], era: "1970s-1980s (pioneer)", signatureStyle: "Marathon Paradise Garage sets that helped birth house music from disco." },
  { name: "Frankie Knuckles", genres: ["house"], era: "1980s (pioneer)", signatureStyle: "The 'Godfather of House' — soulful, disco-rooted four-on-the-floor grooves." },
  { name: "Ron Hardy", genres: ["house"], era: "1980s (pioneer)", signatureStyle: "Raw, high-energy Chicago warehouse sets that shaped early house." },
  { name: "Nicky Siano", genres: ["disco"], era: "1970s (pioneer)", signatureStyle: "Studio 54-era disco selector known for emotive three-deck blending." },
  { name: "Jean-Michel Jarre", genres: ["electronic", "ambient"], era: "1970s-present (pioneer)", signatureStyle: "Pioneering electronic composer-performer of massive live spectacles." },

  // House
  { name: "Carl Cox", genres: ["house", "techno"], era: "1980s-present", signatureStyle: "High-energy three-deck mixing with relentless techno-house drive." },
  { name: "David Guetta", genres: ["house", "edm"], era: "1990s-present", signatureStyle: "Crossover pop-house production built for mainstream festival stages." },
  { name: "Erick Morillo", genres: ["house"], era: "1990s-2010s", signatureStyle: "Feel-good, groove-driven house anthems (Subliminal Records)." },
  { name: "Danny Tenaglia", genres: ["house", "techno"], era: "1990s-present", signatureStyle: "Marathon New York sets blending tribal house with techno." },
  { name: "Dennis Ferrer", genres: ["house"], era: "1990s-present", signatureStyle: "Deep, soulful New York house with a percussive edge." },
  { name: "Marco Carola", genres: ["house", "techno"], era: "1990s-present", signatureStyle: "Hypnotic, minimal-leaning tech house (Music On)." },
  { name: "Roger Sanchez", genres: ["house"], era: "1990s-present", signatureStyle: "Punchy, vocal-driven house with turntablist precision." },
  { name: "Todd Terry", genres: ["house"], era: "1980s-present", signatureStyle: "Sample-heavy, breakbeat-infused early house production." },
  { name: "Masters at Work", genres: ["house"], era: "1990s-present", signatureStyle: "Kenny 'Dope' Gonzalez & Louie Vega — Latin- and soul-infused house grooves." },
  { name: "Black Coffee", genres: ["house", "afro house"], era: "2000s-present", signatureStyle: "Deep, percussive Afro house with a soulful South African foundation." },
  { name: "Fisher", genres: ["house", "tech house"], era: "2010s-present", signatureStyle: "Playful, bass-heavy tech house built for peak-time crowd chants." },
  { name: "John Summit", genres: ["house", "tech house"], era: "2010s-present", signatureStyle: "Groovy, bassline-driven tech house with festival-ready drops." },
  { name: "Peggy Gou", genres: ["house"], era: "2010s-present", signatureStyle: "Stylish, groove-forward house with a minimal, danceable touch." },
  { name: "Honey Dijon", genres: ["house"], era: "2000s-present", signatureStyle: "Chicago house roots fused with ballroom and disco energy." },

  // Techno
  { name: "Jeff Mills", genres: ["techno"], era: "1990s-present", signatureStyle: "Rapid-fire three-deck cutting with stark, futurist Detroit techno." },
  { name: "Derrick May", genres: ["techno"], era: "1980s-present", signatureStyle: "One of the Belleville Three; melodic, emotive Detroit techno." },
  { name: "Juan Atkins", genres: ["techno"], era: "1980s-present", signatureStyle: "Widely credited as the originator of Detroit techno." },
  { name: "Kevin Saunderson", genres: ["techno"], era: "1980s-present", signatureStyle: "Belleville Three member known for bass-driven, funk-inflected techno." },
  { name: "Richie Hawtin", genres: ["techno", "minimal"], era: "1990s-present", signatureStyle: "Minimal techno pioneer known for precise, stripped-down mixing." },
  { name: "Sven Väth", genres: ["techno"], era: "1980s-present", signatureStyle: "Cocoon Recordings founder blending techno with organic, trippy textures." },
  { name: "Charlotte de Witte", genres: ["techno"], era: "2010s-present", signatureStyle: "Dark, hard-edged techno with relentless, driving energy." },
  { name: "Amelie Lens", genres: ["techno"], era: "2010s-present", signatureStyle: "Raw, high-intensity techno with hypnotic percussive builds." },
  { name: "Nina Kraviz", genres: ["techno"], era: "2000s-present", signatureStyle: "Eclectic, idiosyncratic techno sets with acid and vocal textures." },
  { name: "Adam Beyer", genres: ["techno"], era: "1990s-present", signatureStyle: "Drumcode label boss known for peak-time, industrial-tinged techno." },
  { name: "Carl Craig", genres: ["techno"], era: "1990s-present", signatureStyle: "Detroit second-wave producer known for jazzy, layered techno." },
  { name: "Laurent Garnier", genres: ["techno"], era: "1990s-present", signatureStyle: "Genre-spanning French techno pioneer with a long-form journey style." },
  { name: "Ben Klock", genres: ["techno"], era: "2000s-present", signatureStyle: "Berghain resident known for deep, dubby, hypnotic techno." },

  // Trance
  { name: "Armin van Buuren", genres: ["trance"], era: "1990s-present", signatureStyle: "Uplifting, anthemic trance and the long-running A State of Trance series." },
  { name: "Tiësto", genres: ["trance", "edm"], era: "1990s-present", signatureStyle: "Trance pioneer turned genre-hopping festival headliner." },
  { name: "Paul van Dyk", genres: ["trance"], era: "1990s-present", signatureStyle: "Emotive, melodic trance with a strong European club pedigree." },
  { name: "Paul Oakenfold", genres: ["trance"], era: "1980s-present", signatureStyle: "Helped popularize trance and progressive house in the UK scene." },
  { name: "Ferry Corsten", genres: ["trance"], era: "1990s-present", signatureStyle: "Driving, euphoric trance production under multiple aliases." },
  { name: "Above & Beyond", genres: ["trance", "progressive"], era: "2000s-present", signatureStyle: "Emotive, song-based progressive trance with lush vocals." },
  { name: "Judge Jules", genres: ["trance"], era: "1990s-present", signatureStyle: "Long-running UK trance and dance radio mainstay." },

  // EDM / Festival / Big Room
  { name: "Calvin Harris", genres: ["edm", "house"], era: "2000s-present", signatureStyle: "Pop-crossover dance production with big, hook-driven drops." },
  { name: "Avicii", genres: ["edm", "progressive house"], era: "2010s", signatureStyle: "Melodic, folk-tinged progressive house that helped define festival EDM." },
  { name: "Martin Garrix", genres: ["edm", "big room"], era: "2010s-present", signatureStyle: "Big room anthems built for mainstage festival drops." },
  { name: "Skrillex", genres: ["dubstep", "edm"], era: "2010s-present", signatureStyle: "Aggressive, bass-heavy dubstep that helped define the American brostep sound." },
  { name: "Diplo", genres: ["edm", "moombahton"], era: "2000s-present", signatureStyle: "Genre-blending selector spanning moombahton, trap, and pop crossover." },
  { name: "Marshmello", genres: ["edm", "future bass"], era: "2010s-present", signatureStyle: "Melodic, accessible future bass and big-room production." },
  { name: "Steve Aoki", genres: ["edm", "big room"], era: "2000s-present", signatureStyle: "High-energy, showmanship-driven big room sets." },
  { name: "Zedd", genres: ["edm", "electro house"], era: "2010s-present", signatureStyle: "Polished electro house crossed with pop songwriting." },
  { name: "DJ Snake", genres: ["edm", "trap"], era: "2010s-present", signatureStyle: "Trap-infused festival production with hard-hitting drops." },
  { name: "The Chainsmokers", genres: ["edm", "pop dance"], era: "2010s-present", signatureStyle: "Pop-leaning EDM built around vocal hooks." },
  { name: "Kygo", genres: ["edm", "tropical house"], era: "2010s-present", signatureStyle: "Helped define tropical house's warm, melodic sound." },
  { name: "Alesso", genres: ["edm", "progressive house"], era: "2010s-present", signatureStyle: "Melodic progressive house with festival-scale builds." },
  { name: "Hardwell", genres: ["edm", "big room"], era: "2010s-present", signatureStyle: "Big room house anthems built for mainstage energy." },
  { name: "Afrojack", genres: ["edm", "electro house"], era: "2010s-present", signatureStyle: "Punchy electro house with a Dutch big-room edge." },
  { name: "Swedish House Mafia", genres: ["edm", "progressive house"], era: "2000s-present", signatureStyle: "Axwell, Steve Angello & Sebastian Ingrosso's anthemic progressive house." },

  // Hip-Hop / Turntablism
  { name: "DJ Jazzy Jeff", genres: ["hip-hop", "turntablism"], era: "1980s-present", signatureStyle: "Smooth, technically precise scratch routines and crowd-reading sets." },
  { name: "DJ Premier", genres: ["hip-hop"], era: "1980s-present", signatureStyle: "Gritty, sample-based boom bap production and scratch hooks." },
  { name: "DJ Shadow", genres: ["hip-hop", "trip-hop"], era: "1990s-present", signatureStyle: "Sample-collage instrumental hip-hop with a cinematic feel." },
  { name: "Q-Bert", genres: ["turntablism", "hip-hop"], era: "1990s-present", signatureStyle: "Battle-DJ legend known for intricate scratch and beat-juggling routines." },
  { name: "Mix Master Mike", genres: ["turntablism", "hip-hop"], era: "1990s-present", signatureStyle: "Explosive, rock-influenced turntablism with the Beastie Boys." },
  { name: "DJ Craze", genres: ["turntablism", "hip-hop"], era: "1990s-present", signatureStyle: "Three-time DMC World Champion known for rapid-fire scratch technique." },
  { name: "Cut Chemist", genres: ["hip-hop", "turntablism"], era: "1990s-present", signatureStyle: "Crate-digging blend of funk, soul, and breakbeats." },
  { name: "DJ Z-Trip", genres: ["hip-hop", "turntablism"], era: "1990s-present", signatureStyle: "Genre-blending mashup pioneer spanning rock, hip-hop, and funk." },

  // Dubstep / Bass
  { name: "Excision", genres: ["dubstep", "bass music"], era: "2010s-present", signatureStyle: "Heavy, distorted riddim-leaning dubstep basslines." },
  { name: "Rusko", genres: ["dubstep"], era: "2000s-2010s", signatureStyle: "Wobbly, playful UK dubstep basslines." },
  { name: "Flux Pavilion", genres: ["dubstep"], era: "2010s-present", signatureStyle: "Melodic, hook-driven dubstep with wide crossover appeal." },
  { name: "Zomboy", genres: ["dubstep", "bass music"], era: "2010s-present", signatureStyle: "Aggressive, riff-driven dubstep drops." },
  { name: "Zeds Dead", genres: ["dubstep", "bass music"], era: "2000s-present", signatureStyle: "Bass-heavy, genre-blending dubstep and trap production." },
  { name: "Datsik", genres: ["dubstep"], era: "2010s-present", signatureStyle: "Heavy, aggressive dubstep basslines and drops." },

  // Drum & Bass / Jungle
  { name: "Andy C", genres: ["drum and bass"], era: "1990s-present", signatureStyle: "Technically flawless, high-energy drum & bass mixing." },
  { name: "Goldie", genres: ["drum and bass", "jungle"], era: "1990s-present", signatureStyle: "Jungle pioneer known for atmospheric, breakbeat-driven production." },
  { name: "Fabio & Grooverider", genres: ["drum and bass", "jungle"], era: "1990s-present", signatureStyle: "Foundational jungle/DnB duo from the UK pirate radio scene." },
  { name: "Chase & Status", genres: ["drum and bass"], era: "2000s-present", signatureStyle: "Punchy, festival-ready drum & bass with rock and hip-hop crossover." },
  { name: "High Contrast", genres: ["drum and bass"], era: "2000s-present", signatureStyle: "Soulful, melodic drum & bass production." },
  { name: "Netsky", genres: ["drum and bass", "liquid dnb"], era: "2010s-present", signatureStyle: "Smooth, melodic liquid drum & bass." },

  // Disco / Funk
  { name: "Nile Rodgers", genres: ["disco", "funk"], era: "1970s-present", signatureStyle: "Chic guitarist-producer whose funk/disco grooves shaped dance music." },
  { name: "Moodymann", genres: ["house", "funk"], era: "1990s-present", signatureStyle: "Soulful, sample-rich Detroit house steeped in funk and R&B." },

  // Female icons (cross-genre, beyond dupes above)
  { name: "Alison Wonderland", genres: ["bass music", "edm"], era: "2010s-present", signatureStyle: "Emotive, bass-heavy production with a personal, songwriter's edge." },
  { name: "Rezz", genres: ["bass music", "techno"], era: "2010s-present", signatureStyle: "Hypnotic, midtempo bass with a dark, glitchy signature sound." },
  { name: "TOKiMONSTA", genres: ["beat music", "hip-hop"], era: "2010s-present", signatureStyle: "Genre-blending beat music rooted in hip-hop and electronic soul." },
  { name: "Anna Lunoe", genres: ["house", "bass music"], era: "2010s-present", signatureStyle: "Punchy, bass-forward house with festival-ready energy." },
  { name: "The Blessed Madonna", genres: ["house"], era: "2010s-present", signatureStyle: "Emotive, community-rooted house with a classic disco lineage." },

  // Crossover / Alternative legends
  { name: "Fatboy Slim", genres: ["big beat", "breakbeat"], era: "1990s-present", signatureStyle: "Big beat pioneer known for playful, sample-heavy party sets." },
  { name: "Moby", genres: ["electronic", "techno"], era: "1990s-present", signatureStyle: "Genre-spanning electronic producer blending techno with alternative rock." },
  { name: "The Prodigy", genres: ["big beat", "breakbeat"], era: "1990s-present", signatureStyle: "Liam Howlett's aggressive, rave-rooted breakbeat and big beat." },
  { name: "The Chemical Brothers", genres: ["big beat", "breakbeat"], era: "1990s-present", signatureStyle: "Psychedelic, breakbeat-driven big beat with live-show spectacle." },
  { name: "Basement Jaxx", genres: ["house", "big beat"], era: "1990s-present", signatureStyle: "Eclectic, carnival-esque house with global influences." },

  // Recent / current stars (beyond dupes above)
  { name: "Fred again..", genres: ["house", "electronic"], era: "2020s-present", signatureStyle: "Diary-like, sample-driven house blending intimate vocal snippets." },
  { name: "ANOTR", genres: ["house", "tech house"], era: "2020s-present", signatureStyle: "Groove-first tech house with a raw, warehouse energy." },
  { name: "Overmono", genres: ["house", "electronic"], era: "2020s-present", signatureStyle: "UK duo blending rave breaks with melodic dance production." },
  { name: "Disclosure", genres: ["house", "uk garage"], era: "2010s-present", signatureStyle: "UK garage-inflected house with soulful vocal hooks." },
];
