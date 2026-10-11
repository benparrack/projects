// 20 Questions knowledge base: ~170 common nouns in five categories x ~65 yes/no attributes.
// Used by the server's bot (as picker it answers the human's free-text questions by matching
// keywords to an attribute; as guesser it asks the attribute questions) and to offer the picker
// three random word suggestions.
//
// Each noun line is `name ; category ; aliases ; tags`. Aliases are synonyms (a guess of one is
// correct); `~word` marks a merely related word. Tags are attribute ids that are YES
// for it, `~id` for SOMETIMES, and everything not listed is NO. Category defaults (below) are
// merged in first, so e.g. every animal is automatically `animal alive`.
//
// Attribute keywords are matched against a normalised question on word boundaries; the longest
// matching keyword wins. A keyword starting with `!` answers the opposite of the attribute
// ("is it natural?" -> NOT manmade). Keep keywords lowercase, letters/spaces/apostrophes only.

'use strict';

const CATEGORIES = ['animal', 'food', 'object', 'place', 'person'];
const CATEGORY_LABEL = { animal: 'Animal', food: 'Food & Drink', object: 'Object', place: 'Place', person: 'Person / Job' };

const ATTRS = [
  // --- category ---
  { id: 'animal', q: 'Is it an animal?', kw: ['animal', 'an animal', 'creature', 'critter', 'beast'] },
  { id: 'food', q: 'Can you eat or drink it?', kw: ['food', 'eat', 'eat it', 'edible', 'eaten', 'snack', 'meal', 'something you eat', 'eat or drink'] },
  { id: 'object', q: 'Is it an object you could own?', kw: ['object', 'thing', 'item', 'own it', 'possession'] },
  { id: 'place', q: 'Is it a place?', kw: ['place', 'location', 'somewhere', 'a place', 'go there', 'visit', 'destination'] },
  { id: 'person', q: 'Is it a person or a job?', kw: ['person', 'people', 'human', 'job', 'someone', 'occupation', 'profession', 'career', 'man', 'woman', 'a person', 'worker'] },
  // --- nature of the thing ---
  { id: 'alive', q: 'Is it alive?', kw: ['alive', 'living', 'living thing', 'breathe', 'breathes', 'a living', '!dead', 'is it living'] },
  { id: 'manmade', q: 'Is it made by people?', kw: ['man made', 'manmade', 'made by people', 'made by humans', 'human made', 'built', 'factory', 'invented', 'made in a factory', '!natural', '!nature', '!found in nature'] },
  { id: 'mammal', q: 'Is it a mammal?', kw: ['mammal', 'mammals'] },
  { id: 'bird', q: 'Is it a bird?', kw: ['bird', 'birds', 'feathers', 'feathered', 'beak'] },
  { id: 'fish', q: 'Is it a fish?', kw: ['fish', 'fishes', 'gills', 'fins'] },
  { id: 'insect', q: 'Is it an insect or bug?', kw: ['insect', 'bug', 'bugs', 'insects', 'creepy crawly'] },
  { id: 'water', q: 'Does it live in or near water?', kw: ['water', 'swim', 'swims', 'ocean', 'sea', 'lake', 'river', 'wet', 'underwater', 'in the water', 'aquatic'] },
  { id: 'fly', q: 'Can it fly?', kw: ['fly', 'flies', 'flying', 'in the air', 'in the sky', 'airborne', 'wings'] },
  { id: 'pet', q: 'Do people keep it as a pet?', kw: ['pet', 'pets', 'as a pet', 'domestic', 'domesticated', 'tame'] },
  { id: 'farm', q: 'Would you find it on a farm?', kw: ['farm', 'farms', 'barn', 'farm animal', 'on a farm'] },
  { id: 'wild', q: 'Does it live in the wild?', kw: ['wild', 'wildlife', 'jungle', 'in the wild', 'safari'] },
  { id: 'africa', q: 'Is it found in Africa?', kw: ['africa', 'african', 'savanna', 'savannah'] },
  { id: 'withanimals', q: 'Does it involve working with animals?', kw: ['with animals', 'work with animals', 'animals there', 'take care of animals', 'care for animals', 'involve animals', 'have animals'] },
  { id: 'fur', q: 'Does it have fur?', kw: ['fur', 'furry', 'hair', 'hairy', 'fuzzy', 'fluffy'] },
  { id: 'legs4', q: 'Does it have four legs?', kw: ['four legs', '4 legs', 'four feet', 'four leg', 'on all fours'] },
  { id: 'stripes', q: 'Does it have stripes?', kw: ['stripes', 'striped', 'stripey', 'stripy'] },
  { id: 'dangerous', q: 'Can it be dangerous?', kw: ['dangerous', 'danger', 'deadly', 'harmful', 'hurt you', 'kill you', 'bite', 'bites', 'scary', 'poisonous', 'venomous', 'sting', 'stings', '!safe'] },
  { id: 'carnivore', q: 'Does it eat meat?', kw: ['eat meat', 'eats meat', 'carnivore', 'carnivorous', 'predator', 'hunt', 'hunts', 'eat other animals', 'eats other animals'] },
  { id: 'eggs', q: 'Does it lay eggs?', kw: ['lay eggs', 'lays eggs', 'laying eggs', 'hatch', 'hatches', 'egg laying'] },
  // --- physical ---
  { id: 'big', q: 'Is it bigger than a person?', kw: ['big', 'bigger', 'large', 'larger', 'huge', 'giant', 'enormous', 'tall', 'taller', 'bigger than a person', 'bigger than me', 'bigger than a human', 'larger than a person'] },
  { id: 'small', q: 'Can you hold it in one hand?', kw: ['!bigger than a breadbox', '!bigger than a shoebox', '!bigger than a microwave', '!bigger than a loaf of bread', 'smaller than a breadbox', 'small', 'smaller', 'tiny', 'little', 'hold it', 'hold in', 'in your hand', 'one hand', 'pocket', 'fit in', 'handheld', 'hand held', 'smaller than a', 'pick it up', 'carry it'] },
  { id: 'heavy', q: 'Is it heavy?', kw: ['heavy', 'heavier', 'weigh', 'weighs', 'weight', 'lift it', '!light weight', '!lightweight'] },
  { id: 'electronic', q: 'Does it use electricity?', kw: ['electricity', 'electric', 'electronic', 'electronics', 'battery', 'batteries', 'plug', 'plugged in', 'power', 'powered', 'turn on', 'turn it on', 'switch on', 'device', 'gadget', 'screen', 'technology', 'tech'] },
  { id: 'wheels', q: 'Does it have wheels?', kw: ['wheel', 'wheels'] },
  { id: 'vehicle', q: 'Is it a vehicle or used for travel?', kw: ['vehicle', 'transport', 'transportation', 'ride', 'ride in', 'ride on', 'drive', 'driven', 'travel', 'get around', 'passengers'] },
  { id: 'metal', q: 'Is it made of metal?', kw: ['metal', 'metallic', 'steel', 'iron', 'aluminum', 'aluminium', 'gold', 'silver'] },
  { id: 'wood', q: 'Is it made of wood?', kw: ['wood', 'wooden', 'timber', 'trees'] },
  { id: 'glass', q: 'Does it have glass in it?', kw: ['glass', 'see through', 'transparent'] },
  { id: 'soft', q: 'Is it soft?', kw: ['soft', 'squishy', 'cuddly', 'squeeze', 'squishy', 'fabric', 'cloth', '!hard'] },
  { id: 'round', q: 'Is it round?', kw: ['round', 'circle', 'circular', 'sphere', 'ball shaped', 'spherical', 'roll'] },
  { id: 'sharp', q: 'Is it sharp or pointy?', kw: ['sharp', 'pointy', 'pointed', 'cut', 'cuts', 'blade', 'spiky'] },
  // --- where / what for ---
  { id: 'house', q: 'Would you find it in a house?', kw: ['house', 'home', 'houses', 'homes', 'indoors', 'inside', 'in a house', 'at home', 'bedroom', 'living room', 'apartment'] },
  { id: 'kitchen', q: 'Would you find it in a kitchen?', kw: ['kitchen', 'cook', 'cooking', 'cooks', 'cook with', 'fridge', 'stove'] },
  { id: 'outside', q: 'Is it found outdoors?', kw: ['outside', 'outdoors', 'outdoor', 'nature', 'in nature'] },
  { id: 'sport', q: 'Is it to do with sports?', kw: ['sport', 'sports', 'exercise', 'athletic', 'team', 'compete', 'competition', 'olympics'] },
  { id: 'toy', q: 'Is it used for fun or entertainment?', kw: ['fun', 'toy', 'toys', 'play', 'play with', 'game', 'games', 'entertainment', 'entertaining', 'entertain', 'hobby'] },
  { id: 'school', q: 'Is it to do with school or learning?', kw: ['school', 'schools', 'learn', 'learning', 'study', 'studying', 'education', 'educational', 'class', 'classroom', 'office', 'homework', 'write', 'writing', 'read', 'reading'] },
  { id: 'wear', q: 'Do you wear it?', kw: ['wear', 'wears', 'worn', 'clothing', 'clothes', 'put on', 'accessory', 'outfit'] },
  { id: 'noise', q: 'Does it make noise?', kw: ['noise', 'noisy', 'sound', 'sounds', 'loud', 'make a sound', 'talk', 'speak', 'bark', 'roar', '!quiet', '!silent'] },
  { id: 'music', q: 'Is it to do with music?', kw: ['music', 'musical', 'instrument', 'song', 'songs', 'sing', 'sings', 'singing', 'band'] },
  { id: 'cold', q: 'Is it cold?', kw: ['cold', 'ice', 'icy', 'snow', 'snowy', 'freezing', 'frozen', 'freezer', 'winter', 'chilly', 'refrigerated'] },
  { id: 'expensive', q: 'Is it expensive?', kw: ['expensive', 'cost a lot', 'costs a lot', 'pricey', 'valuable', 'rich', 'luxury', 'worth a lot', '!cheap'] },
  // --- food ---
  { id: 'sweet', q: 'Is it sweet?', kw: ['sweet', 'sugar', 'sugary', 'dessert', 'candy', 'treat'] },
  { id: 'fruit', q: 'Is it a fruit?', kw: ['fruit', 'fruits', 'fruity'] },
  { id: 'vegetable', q: 'Is it a vegetable?', kw: ['vegetable', 'vegetables', 'veggie', 'veggies', 'veg'] },
  { id: 'plant', q: 'Does it come from a plant?', kw: ['plant', 'plants', 'grow', 'grows', 'grown', 'tree', 'from a plant', 'garden', 'seeds', 'leaves', 'vegan'] },
  { id: 'hot', q: 'Is it hot?', kw: ['hot', 'warm', 'heat', 'heated', 'cooked', 'spicy', 'fire', 'burn', 'burns'] },
  { id: 'drink', q: 'Is it a drink?', kw: ['drink', 'drinks', 'liquid', 'beverage', 'sip', 'pour', 'juice'] },
  { id: 'breakfast', q: 'Do people have it for breakfast?', kw: ['breakfast', 'morning'] },
  { id: 'fromanimal', q: 'Does it come from an animal?', kw: ['from an animal', 'come from an animal', 'comes from an animal', 'made from an animal', 'meat', 'dairy', 'milk', 'animal product'] },
  { id: 'healthy', q: 'Is it healthy?', kw: ['healthy', 'good for you', 'nutritious', 'vitamins', 'diet', '!unhealthy', '!junk food', '!bad for you'] },
  // --- colour ---
  { id: 'red', q: 'Is it red?', kw: ['red'] },
  { id: 'green', q: 'Is it green?', kw: ['green'] },
  { id: 'yellow', q: 'Is it yellow?', kw: ['yellow', 'golden'] },
  { id: 'brown', q: 'Is it brown?', kw: ['brown'] },
  { id: 'white', q: 'Is it white?', kw: ['white'] },
  { id: 'orange', q: 'Is it orange?', kw: ['orange'] },
  { id: 'sit', q: 'Can you sit on it or in it?', kw: ['sit', 'sit on', 'sit in', 'seat', 'seats', 'ride on it'] },
  { id: 'container', q: 'Can you put things in it?', kw: ['container', 'hold things', 'put things in', 'put stuff in', 'store things', 'keep things in', 'carry things', 'contain', 'contains', 'put things inside'] },
  { id: 'road', q: 'Is it found on roads?', kw: ['road', 'roads', 'street', 'streets', 'highway', 'traffic'] },
  { id: 'dark', q: 'Is it dark?', kw: ['dark', 'darkness', 'night', 'nighttime', 'nocturnal', 'at night'] },
  { id: 'money', q: 'Is it to do with money or shopping?', kw: ['money', 'buy', 'buying', 'shop', 'shopping', 'sell', 'sells', 'purchase', 'pay', 'paid', 'cash'] },
  { id: 'old', q: 'Is it old or historic?', kw: ['old', 'ancient', 'history', 'historic', 'historical', 'long ago', 'olden days', 'past'] },
  // --- places / people ---
  { id: 'building', q: 'Is it a building?', kw: ['building', 'buildings', 'roof', 'walls', 'indoor place'] },
  { id: 'uniform', q: 'Do they wear a uniform?', kw: ['uniform', 'uniforms', 'costume'] },
  { id: 'helps', q: 'Does it help or protect people?', kw: ['help', 'helps', 'helpful', 'helping', 'save', 'saves', 'rescue', 'protect', 'protects', 'serve', 'serves'] },
  { id: 'medical', q: 'Is it to do with health or medicine?', kw: ['medical', 'medicine', 'hospital', 'sick', 'health', 'heal', 'heals', 'injured', 'teeth', 'doctors'] },
  { id: 'kids', q: 'Is it to do with children?', kw: ['kids', 'children', 'child', 'kid', 'baby', 'babies', 'young'] },
  { id: 'tools', q: 'Does it use tools?', kw: ['tool', 'tools', 'equipment', 'fix', 'fixes', 'repair', 'build things'] },
];

// Merged into every noun of the category before its own tags (a noun can override with ~id).
const CATEGORY_DEFAULTS = {
  animal: 'animal alive',
  food: 'food',
  object: 'object manmade',
  place: 'place big',
  person: 'person alive',
};

const NOUNS_TEXT = `
dog;animal;puppy,doggy,doggo;mammal pet fur legs4 house outside noise ~carnivore ~dangerous ~brown ~white
cat;animal;kitten,kitty;mammal pet fur legs4 house carnivore soft ~outside ~noise ~brown ~white ~stripes ~orange
horse;animal;pony;mammal farm fur legs4 big heavy outside noise vehicle ~pet ~brown ~white ~wild ~sport sit
cow;animal;~bull,calf;mammal farm fur legs4 big heavy outside noise ~brown ~white
pig;animal;piglet,hog;mammal farm legs4 outside noise ~pet ~heavy ~fur
sheep;animal;lamb;mammal farm fur legs4 outside noise white soft
chicken;animal;hen,rooster,chick;bird farm eggs outside noise ~fly ~white ~brown ~pet
duck;animal;duckling;bird farm water fly eggs outside noise ~wild ~pet ~white ~brown ~green ~yellow
rabbit;animal;bunny;mammal pet fur legs4 soft outside ~house ~wild ~farm ~white ~brown ~small
mouse;animal;mice,~rat;mammal fur legs4 small house ~pet ~wild ~brown ~white
lion;animal;lioness;mammal wild africa fur legs4 dangerous carnivore big heavy noise outside yellow ~brown ~orange
tiger;animal;;mammal wild fur legs4 stripes dangerous carnivore big heavy noise outside ~white orange
elephant;animal;;mammal wild africa legs4 big heavy noise outside ~dangerous ~sit
giraffe;animal;;mammal wild africa legs4 big heavy outside yellow ~brown
monkey;animal;~ape,~chimp,~chimpanzee,~gorilla;mammal wild fur outside noise ~africa ~brown ~pet ~dangerous ~big
bear;animal;grizzly;mammal wild fur legs4 big heavy dangerous outside noise brown ~carnivore ~white ~cold
wolf;animal;;mammal wild fur legs4 dangerous carnivore outside noise ~cold ~white
fox;animal;;mammal wild fur legs4 carnivore outside red ~white ~house ~orange
deer;animal;~reindeer,~moose;mammal wild fur legs4 outside brown ~big ~cold
zebra;animal;;mammal wild africa fur legs4 stripes outside white ~big ~noise
kangaroo;animal;;mammal wild fur outside brown ~big ~dangerous
shark;animal;;fish water wild dangerous carnivore big ~heavy
whale;animal;;mammal water wild big heavy noise ~cold ~carnivore
dolphin;animal;;mammal water wild noise carnivore ~big
goldfish;animal;;fish water pet small house eggs orange
octopus;animal;~squid;water wild soft carnivore ~dangerous ~red
frog;animal;~toad;water wild small green outside eggs noise ~pet ~brown
snake;animal;;wild dangerous carnivore outside eggs ~pet ~green ~brown ~water ~stripes
turtle;animal;~tortoise;water wild outside eggs ~pet ~green ~brown ~heavy ~small ~big
crocodile;animal;~alligator;water wild africa dangerous carnivore big heavy eggs outside green ~noise
eagle;animal;~hawk;bird wild fly carnivore outside eggs brown ~white ~dangerous
owl;animal;;bird wild fly carnivore outside eggs noise brown ~white ~dark
penguin;animal;;bird wild water eggs cold outside white ~noise ~carnivore
parrot;animal;;bird pet fly eggs noise green house ~red ~yellow ~wild
bee;animal;bumblebee,~wasp;insect fly small outside dangerous stripes yellow noise ~farm ~wild ~eggs
butterfly;animal;~moth;insect fly small outside wild eggs ~yellow ~red ~green ~white ~orange
spider;animal;~tarantula;small house outside carnivore eggs ~insect ~dangerous ~wild ~brown
ant;animal;;insect small outside eggs ~house ~red ~brown ~wild ~dangerous
bat;animal;;mammal fly wild fur outside noise ~carnivore ~dangerous ~small ~dark
camel;animal;;mammal legs4 big heavy outside brown noise ~farm ~wild ~africa ~vehicle sit
apple;food;;fruit plant red sweet healthy small round kitchen house ~green ~yellow ~breakfast
banana;food;;fruit plant yellow sweet healthy small kitchen house breakfast ~green
orange;food;;fruit plant sweet healthy small round kitchen house ~breakfast orange
strawberry;food;strawberries;fruit plant red sweet healthy small kitchen house ~breakfast
grapes;food;grape;fruit plant sweet healthy small kitchen house ~green ~round
watermelon;food;~melon;fruit plant green red sweet healthy round kitchen house ~heavy ~outside
lemon;food;~lime;fruit plant yellow small kitchen house ~round ~healthy ~drink
carrot;food;;vegetable plant healthy small kitchen house ~hot orange
potato;food;potatoes;vegetable plant brown small kitchen house ~hot ~healthy ~round
tomato;food;tomatoes;plant red round small healthy kitchen house ~fruit ~vegetable ~green
broccoli;food;;vegetable plant green healthy kitchen house ~hot
corn;food;sweetcorn;vegetable plant yellow kitchen house ~healthy ~hot ~farm
onion;food;;vegetable plant small round kitchen house ~hot ~white ~red
bread;food;~toast,loaf;manmade brown kitchen house breakfast ~plant ~hot ~healthy soft
cheese;food;;fromanimal manmade yellow kitchen house ~white ~small ~healthy ~orange
egg;food;eggs;fromanimal breakfast small kitchen house ~hot ~white ~brown ~round ~healthy ~farm
milk;food;;drink fromanimal white kitchen house breakfast healthy ~cold ~farm
pizza;food;;manmade hot round ~red ~yellow ~kitchen ~fromanimal
hamburger;food;burger,cheeseburger;manmade hot fromanimal brown ~red ~green ~kitchen round
hot dog;food;hotdog,~sausage;manmade hot fromanimal ~red ~brown ~yellow ~sport
ice cream;food;icecream,ice-cream;manmade sweet cold fromanimal kitchen house ~white ~brown ~red
chocolate;food;;manmade sweet brown small kitchen house ~fromanimal ~expensive
cake;food;~cupcake;manmade sweet soft kitchen house ~fromanimal ~round ~white ~brown ~red ~expensive
cookie;food;cookies,biscuit;manmade sweet small round brown kitchen house ~fromanimal
pancake;food;pancakes,~waffle;manmade breakfast hot round soft kitchen house ~sweet ~fromanimal ~brown ~yellow
cereal;food;;manmade breakfast kitchen house ~sweet ~healthy ~plant ~yellow ~brown
soup;food;;manmade hot kitchen house ~healthy ~drink ~fromanimal
rice;food;;plant white kitchen house hot ~healthy
spaghetti;food;pasta,noodles;manmade hot kitchen house yellow ~red ~plant
sandwich;food;sub;manmade small kitchen house ~fromanimal ~hot ~healthy ~green
coffee;food;espresso,latte;drink hot plant brown breakfast kitchen house ~cold ~sweet ~expensive ~manmade
orange juice;food;~juice;drink plant sweet healthy breakfast kitchen house ~cold ~fruit ~manmade orange
popcorn;food;;manmade plant white ~hot ~yellow ~sweet ~noise ~kitchen ~house
bacon;food;~ham;fromanimal hot breakfast kitchen house ~red ~brown ~farm
honey;food;;sweet fromanimal yellow kitchen house ~healthy ~breakfast
chair;object;~stool;house school ~wood ~metal ~soft ~heavy ~legs4 ~kitchen sit
table;object;~desk;house kitchen school heavy ~wood ~metal ~legs4
bed;object;;house soft heavy ~big ~wood ~kids sit
lamp;object;;house electronic ~metal ~glass ~school ~small
television;object;tv,telly;house electronic glass noise toy ~heavy ~expensive ~big
phone;object;cellphone,cell phone,smartphone,mobile,iphone;electronic small expensive glass noise house ~toy ~school
computer;object;laptop,pc;electronic expensive house school glass ~heavy ~toy ~noise
book;object;books;school house ~small ~toy ~kids
pencil;object;~pen,~crayon;school house small wood sharp yellow ~kids
scissors;object;;school house small sharp metal ~kitchen ~dangerous ~kids
knife;object;~sword;kitchen house small sharp metal dangerous ~tools
spoon;object;~fork;kitchen house small metal ~round
cup;object;~mug,~glass;kitchen house small ~glass ~round ~white ~hot container
plate;object;dish,~bowl;kitchen house round ~small ~glass ~white
clock;object;~watch;house school round ~electronic ~noise ~metal ~glass ~wood ~wear ~small ~old
key;object;keys;small metal house ~yellow
umbrella;object;;outside ~house ~metal ~small ~sharp ~water
shoe;object;shoes,boot,boots,sneaker,sneakers;wear house ~sport ~brown ~expensive ~white outside
hat;object;cap;wear soft ~outside ~cold ~sport ~house
glasses;object;~sunglasses,spectacles;wear glass small ~expensive ~metal ~medical
toothbrush;object;;house small medical ~electronic ~white ~healthy
pillow;object;cushion;house soft white ~kids ~sit
ball;object;football,soccer ball,basketball;sport toy round outside kids ~small ~soft ~noise ~red ~white ~orange
guitar;object;;music noise wood expensive ~electronic ~toy
piano;object;~keyboard;music noise heavy wood expensive house white ~big ~school ~electronic ~sit
bicycle;object;bike;wheels vehicle metal outside ~sport ~toy ~kids ~expensive sit road
car;object;automobile;wheels vehicle metal outside heavy expensive noise glass ~big ~electronic ~red sit road ~container
bus;object;;wheels vehicle metal outside heavy big noise glass ~school ~yellow ~kids sit road
train;object;;wheels vehicle metal outside heavy big noise glass ~expensive ~electronic sit
airplane;object;plane,aeroplane,jet;fly vehicle wheels metal outside heavy big noise expensive glass white ~electronic sit
boat;object;ship,sailboat;vehicle water outside ~big ~heavy ~wood ~metal ~noise ~expensive ~sport sit
helicopter;object;;fly vehicle metal outside heavy big noise expensive glass ~electronic ~helps sit
refrigerator;object;fridge,~freezer;kitchen house electronic heavy cold ~big ~metal ~white ~noise ~expensive container
microwave;object;~oven;kitchen house electronic hot ~glass ~metal ~noise ~white container
candle;object;;house hot small ~red ~white ~dangerous
mirror;object;;house glass ~small ~wood
backpack;object;~bag,schoolbag;school kids ~wear ~soft ~outside container
wallet;object;~purse;small ~expensive ~brown ~house container money
coin;object;~money,penny,~cash;small metal round ~yellow ~expensive money
camera;object;;electronic small expensive glass ~toy ~noise
hammer;object;;tools metal small ~heavy ~wood ~dangerous ~house
balloon;object;;toy kids ~round ~fly ~soft ~red ~yellow ~noise ~small
kite;object;;toy fly outside kids ~wood ~red ~yellow ~sport
teddy bear;object;teddy,stuffed animal;toy kids soft house ~fur ~small ~brown
sock;object;socks;wear soft small house ~white
ring;object;;wear small metal round expensive ~yellow
drum;object;drums;music noise ~round ~wood ~metal ~toy ~school
school;place;;manmade building kids school noise ~outside
hospital;place;;manmade building medical helps ~expensive ~kids
beach;place;seaside;outside water yellow ~hot ~sport ~noise
park;place;~garden;~manmade outside green kids ~sport ~toy
zoo;place;;manmade outside withanimals kids toy ~wild ~africa ~expensive ~building
airport;place;;manmade building fly noise ~vehicle ~expensive ~outside
library;place;;manmade building school ~kids
restaurant;place;~cafe,~diner;manmade building kitchen ~hot ~expensive ~noise ~money
farm;place;;outside farm withanimals ~green ~brown ~building ~noise
forest;place;woods;outside wild green ~brown ~dangerous ~dark wood
desert;place;;outside hot yellow ~africa ~dangerous ~brown
mountain;place;mountains,~hill;outside ~cold ~white ~wild ~dangerous ~green ~brown ~old
ocean;place;sea;outside water ~cold ~dangerous noise ~sport ~dark wild
supermarket;place;grocery store,shop,store,~mall;manmade building ~noise money
castle;place;~palace;manmade building ~expensive ~kids ~cold old
museum;place;;manmade building school ~expensive ~kids old toy
swimming pool;place;pool;manmade water sport ~outside ~building ~kids ~cold ~hot
island;place;;outside water ~hot ~yellow ~wild green
cave;place;;outside ~cold ~wild ~dangerous ~water ~brown dark
volcano;place;;outside hot dangerous ~red ~noise ~wild ~brown ~old
movie theater;place;cinema,movies,theater,theatre;manmade building toy noise ~expensive ~kids dark ~money
bank;place;;manmade building expensive ~uniform money
stadium;place;arena;manmade sport noise ~building ~outside ~kids ~expensive
playground;place;;manmade outside kids toy ~sport ~metal ~wood
space;place;outer space;fly cold dangerous ~expensive dark
church;place;~temple,~cathedral;manmade building ~white ~wood ~old music
doctor;person;physician;medical helps ~uniform ~white ~school expensive
nurse;person;;medical helps uniform ~kids ~white
teacher;person;;school kids helps ~noise
firefighter;person;fireman,firefighters;helps uniform dangerous hot outside ~vehicle ~red ~tools
police officer;person;police,cop,policeman,policewoman;helps uniform dangerous ~outside ~vehicle ~road
chef;person;cook;kitchen hot ~uniform ~white ~sharp ~tools
farmer;person;;farm outside withanimals ~tools ~vehicle ~brown plant
pilot;person;;fly uniform vehicle ~expensive
astronaut;person;;fly uniform dangerous ~cold ~white ~expensive
dentist;person;;medical helps tools ~sharp ~white ~kids
baker;person;;kitchen hot ~uniform ~white sweet
mail carrier;person;mailman,postman,postwoman,mail man;outside uniform helps ~vehicle ~road
singer;person;rock star,popstar,pop star;music noise toy ~expensive
soldier;person;;uniform dangerous outside ~helps ~vehicle ~tools green
clown;person;;kids toy noise ~uniform red
king;person;~queen,~prince,~princess;expensive ~helps ~yellow ~wear ~money
baby;person;;kids noise house ~small ~soft
lifeguard;person;;water helps outside ~hot ~sport ~uniform ~red
veterinarian;person;vet;medical helps withanimals ~tools ~kids
artist;person;painter;toy ~expensive ~kids ~house tools
scientist;person;;school tools ~medical ~white ~dangerous ~expensive
football player;person;~athlete,soccer player,footballer;sport outside uniform ~noise ~expensive ~dangerous
mechanic;person;;tools ~vehicle ~metal ~outside ~road
waiter;person;waitress,server;helps ~kitchen ~uniform
magician;person;~wizard;toy ~kids ~noise ~uniform
cowboy;person;cowgirl;withanimals outside farm ~dangerous ~brown ~wild old
pirate;person;;water dangerous ~vehicle ~expensive ~outside ~money old
`;

// --- parsing ---
const ATTR_INDEX = new Map(ATTRS.map((a, i) => [a.id, i]));
const ANSWER = { Y: 'yes', N: 'no', S: 'sometimes' };

const NOUNS = [];
for (const raw of NOUNS_TEXT.split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  const [name, category, aliasText, tagText] = line.split(';').map((s) => s.trim());
  const values = new Array(ATTRS.length).fill('N');
  const tags = `${CATEGORY_DEFAULTS[category] || ''} ${tagText || ''}`.split(/\s+/).filter(Boolean);
  const bad = [];
  for (const t of tags) {
    const some = t.startsWith('~');
    const id = some ? t.slice(1) : t;
    const i = ATTR_INDEX.get(id);
    if (i == null) { bad.push(t); continue; }
    values[i] = some ? 'S' : 'Y';
  }
  NOUNS.push({
    id: NOUNS.length,
    name,
    category,
    // Synonyms count as a correct guess; `~related` words (queen for king, fork for spoon) only map
    // a picker's custom word onto this noun so the bot can still answer questions about it.
    aliases: (aliasText || '').split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('~')),
    related: (aliasText || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('~')).map((s) => s.slice(1)),
    values, // 'Y' | 'N' | 'S' per ATTRS index
    _badTags: bad, // must stay empty (checked by the test)
  });
}

// --- text helpers shared with the server ---
// Lowercase, letters/digits/spaces only, collapsed; hyphens become spaces.
function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonical key for comparing a guess to a word: no articles, no spaces, crude singular.
function wordKey(s) {
  let t = normText(s).replace(/^(a|an|the|some)\s+/, '').replace(/\s+/g, '');
  if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && /(ches|shes|sses|xes|oes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}

const KEY_TO_NOUN = new Map();
// Names and synonyms win over another noun's related words ("glasses" is not cup's "glass").
for (const pass of ['syn', 'related']) {
  for (const n of NOUNS) {
    for (const w of pass === 'syn' ? [n.name, ...n.aliases] : n.related) {
      const k = wordKey(w);
      if (k && !KEY_TO_NOUN.has(k)) KEY_TO_NOUN.set(k, n);
    }
  }
}

function findNoun(word) {
  return KEY_TO_NOUN.get(wordKey(word)) || null;
}

// Prepared keyword table: [{ attr, re, len, invert }], longest first.
const KEYWORDS = [];
ATTRS.forEach((a, i) => {
  for (let k of a.kw) {
    const invert = k.startsWith('!');
    if (invert) k = k.slice(1);
    const phrase = normText(k);
    if (!phrase) continue;
    KEYWORDS.push({ attr: i, phrase, len: phrase.length, invert, re: new RegExp(`(^| )${phrase.replace(/ /g, ' ')}( |$)`) });
  }
});
KEYWORDS.sort((a, b) => b.len - a.len);

// Which attribute does a free-text question ask about? -> { attr, invert } or null.
function matchAttribute(question) {
  const q = ` ${normText(question)} `.replace(/\s+/g, ' ').trim();
  for (const k of KEYWORDS) if (k.re.test(q)) return { attr: k.attr, invert: k.invert };
  return null;
}

// "is it a dog?" / "is it the ocean" / "a dog?" -> the KB noun being named, else null. An article
// is required unless the bare word isn't also an attribute keyword ("is it orange?" is a colour
// question, "is it rice?" names a noun).
function namedNoun(question) {
  const q = normText(question);
  const m = q.match(/^(?:(?:is|was) (?:it|this|that|your word|the word)|it s|its|could it be|maybe|are you thinking of|are you|is that)\s+(?:(a|an|the|some)\s+)?(.+)$/);
  let article = null;
  let rest = null;
  if (m) { article = m[1] || null; rest = m[2]; } else if (/^(a|an|the)\s+/.test(q)) { rest = q.replace(/^(a|an|the)\s+/, ''); article = 'a'; }
  if (!rest) return null;
  const noun = findNoun(rest);
  if (!noun) return null;
  if (!article && matchAttribute(rest)) return null;
  return noun;
}

module.exports = { CATEGORIES, CATEGORY_LABEL, ATTRS, NOUNS, ANSWER, normText, wordKey, findNoun, matchAttribute, namedNoun };
