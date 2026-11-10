// Built-in food list. Values are per 100 g (or 100 ml for drinks), mostly from USDA FoodData Central,
// Swedish items from Livsmedelsverket and brand labels. Restaurant dishes are typical portions, so treat
// them as estimates.
// Columns: name | kcal | protein | carbs | fat | servings "label=grams;..." | flags (ml = drink, alc = alcohol)
window.FOOD_DB = `
Chicken breast, cooked|165|31|0|3.6|1 breast=150;4 oz=113
Chicken breast, raw|120|22.5|0|2.6|1 breast=200;4 oz=113
Chicken thigh, cooked, skinless|179|24.8|0|8.2|1 thigh=70
Rotisserie chicken, with skin|215|27|0|12|quarter chicken=200;1 cup=140
Ground beef 85/15, cooked|250|26|0|15|4 oz=113;patty=85
Ground beef 93/7, cooked|172|25|0|8|4 oz=113
Steak, sirloin, cooked|206|29|0|9.5|6 oz=170;4 oz=113
Pork chop, cooked|196|27|0|9|1 chop=145
Bacon, cooked|541|37|1.4|42|1 slice=8
Ham, deli sliced|120|18|2|4.5|1 slice=14
Turkey, deli sliced|99|17|4|1.7|1 slice=14
Hot dog (frank)|290|11|4|26|1 frank=50
Falukorv|220|10|6|17|1 slice (1 cm)=25
Köttbullar (Swedish meatballs)|233|14|6|16|1 meatball=15;10 meatballs=150
Salmon, cooked|206|22|0|12|1 fillet=125;4 oz=113
Tuna, canned in water, drained|116|26|0|1|1 can=120
Shrimp, cooked|99|24|0.2|0.3|10 large=55;4 oz=113
Cod, cooked|105|23|0|0.9|1 fillet=150
Fish sticks (fiskpinnar)|220|12|19|10|1 stick=28
Egg|143|12.6|0.7|9.5|1 large=50;1 medium=44
Egg whites|52|10.9|0.7|0.2|1 white=33;1 cup=243
Scrambled eggs (with milk and butter)|149|10|1.6|11|2 eggs=120
Tofu, firm|144|17.3|2.8|8.7|1/2 block=200;100 g=100
Greek yogurt, plain, nonfat|59|10.2|3.6|0.4|1 cup=245;3/4 cup=170
Greek yogurt, plain, 2%|73|10|4|2|1 cup=245;3/4 cup=170
Kvarg (quark), plain|60|10|3.5|0.2|1 tub=500;1 cup=240
Kvarg, flavored (Lindahls)|58|10|4|0.2|1 tub=150
Cottage cheese, 2%|84|11|4.3|2.3|1/2 cup=113;1 cup=226
Keso (cottage cheese, 4%)|98|12.5|2.5|4|1/2 tub=125;1 tub=250
Yogurt, plain, whole milk|61|3.5|4.7|3.3|1 cup=245
Filmjölk 3%|58|3.4|4.4|3|1 glass=200;1 cup=245|ml
Milk, whole|61|3.2|4.8|3.3|1 glass=200;1 cup=244|ml
Milk, 2% (mellanmjölk 1.5%)|50|3.3|4.8|2|1 glass=200;1 cup=244|ml
Milk, skim|34|3.4|5|0.1|1 glass=200;1 cup=244|ml
Oat milk|46|1|6.7|1.5|1 glass=200;1 cup=240|ml
Chocolate milk|85|3.2|10.3|3.4|1 glass=200;1 cup=250|ml
Cheddar cheese|403|23|3.1|33|1 slice=21;1 oz=28
Hard cheese, Swedish (Herrgård, Präst)|365|26|0|29|1 slice=10;3 slices=30
Mozzarella|300|22|2.2|22|1 oz=28;1/2 ball=60
Parmesan|392|35.8|3.2|25.8|1 tbsp grated=5;1 oz=28
Feta|264|14|4|21|1 oz=28;1/4 cup=38
Cream cheese|350|6|5.5|34|1 tbsp=14;2 tbsp=29
Butter|717|0.9|0.1|81|1 tbsp=14;1 pat=5;1 tsp=5
Whey protein powder|400|80|8|6|1 scoop=30
Protein bar|370|30|35|12|1 bar=60
Oats, rolled, dry|379|13.2|67.7|6.5|1/2 cup=40;1 cup=80
Oatmeal, cooked with water|71|2.5|12|1.5|1 cup=234
Granola|471|10|64|20|1/2 cup=60;1/4 cup=30
Cheerios|357|12|73|6|1 cup=28;1 bowl=40
Corn flakes|357|7.5|84|0.4|1 cup=28;1 bowl=40
White rice, cooked|130|2.7|28.2|0.3|1 cup=158;1/2 cup=79
Brown rice, cooked|123|2.7|25.6|1|1 cup=195
Rice, uncooked|365|7.1|80|0.7|1/4 cup=46;1 portion=75
Pasta, cooked|158|5.8|30.9|0.9|1 cup=140;1 plate=250
Pasta, dry|371|13|75|1.5|2 oz=56;1 portion=100
Quinoa, cooked|120|4.4|21.3|1.9|1 cup=185
Couscous, cooked|112|3.8|23.2|0.2|1 cup=157
Potato, baked, with skin|93|2.5|21|0.1|1 medium=173;1 small=138
Potatoes, boiled|86|1.7|20|0.1|1 medium=150;1 cup=156
Mashed potatoes|113|1.9|16.8|4.2|1 cup=210;1/2 cup=105
Sweet potato, baked|90|2|20.7|0.2|1 medium=114
French fries|312|3.4|41|15|small=71;medium=117;large=154
Hash brown|266|2.5|28|16|1 patty=53
Bread, whole wheat|252|12.4|42.7|3.5|1 slice=32
Bread, white|266|8.9|49|3.3|1 slice=29
Knäckebröd (Wasa Husman)|340|9|65|1.5|1 slice=13
Bagel, plain|257|10|50.5|1.6|1 bagel=105
English muffin|235|8.9|46|1.7|1 muffin=57
Tortilla, flour|310|8|51|7.9|1 large (10 in)=72;1 medium (8 in)=49
Tortilla, corn|218|5.7|44.6|2.9|1 tortilla=26
Pita bread|275|9.1|55.7|1.2|1 pita=60
Naan|310|9|50|8|1 piece=90
Hamburger bun|279|9.5|49.4|4.3|1 bun=51
Croissant|406|8.2|45.8|21|1 croissant=57
Pancakes|227|6.4|28.3|9.7|1 pancake (6 in)=77;1 pancake (4 in)=38
Rice cakes|387|8|81|2.8|1 cake=9
Apple|52|0.3|13.8|0.2|1 medium=182;1 small=149
Banana|89|1.1|22.8|0.3|1 medium=118;1 large=136;1 small=101
Orange|47|0.9|11.8|0.1|1 medium=131
Pear|57|0.4|15.2|0.1|1 medium=178
Kiwi|61|1.1|14.7|0.5|1 kiwi=69
Grapes|69|0.7|18.1|0.2|1 cup=151;handful=50
Blueberries|57|0.7|14.5|0.3|1 cup=148;handful=40
Strawberries|32|0.7|7.7|0.3|1 cup=152;1 large=18
Raspberries|52|1.2|11.9|0.7|1 cup=123
Mango|60|0.8|15|0.4|1 cup=165;1 mango=200
Pineapple|50|0.5|13.1|0.1|1 cup=165
Watermelon|30|0.6|7.6|0.2|1 cup=152;1 wedge=286
Avocado|160|2|8.5|14.7|1/2 avocado=75;1 avocado=150
Raisins|299|3.1|79|0.5|1/4 cup=40;1 small box=43
Dates, Medjool|277|1.8|75|0.2|1 date=24
Lingonberry jam (lingonsylt)|190|0.3|46|0.3|1 tbsp=20
Broccoli|34|2.8|6.6|0.4|1 cup=91;1 cup cooked=156
Spinach|23|2.9|3.6|0.4|1 cup=30
Mixed salad greens|15|1.4|2.9|0.2|1 cup=36;1 bowl=85
Carrot|41|0.9|9.6|0.2|1 medium=61;1 cup sliced=122
Cucumber|15|0.7|3.6|0.1|1/2 cucumber=150;1 cup sliced=104
Tomato|18|0.9|3.9|0.2|1 medium=123;1 cherry tomato=17
Bell pepper|31|1|6|0.3|1 medium=119
Onion|40|1.1|9.3|0.1|1 medium=110
Mushrooms|22|3.1|3.3|0.3|1 cup=70
Green beans|35|1.9|7.9|0.3|1 cup=125
Peas|78|5.2|14.3|0.2|1 cup=160
Corn|96|3.4|21|1.5|1 ear=103;1 cup=164
Zucchini|17|1.2|3.1|0.3|1 medium=196
Cauliflower|25|1.9|5|0.3|1 cup=107
Black beans, cooked|132|8.9|23.7|0.5|1 cup=172;1/2 cup=86
Chickpeas, cooked|164|8.9|27.4|2.6|1 cup=164;1/2 cup=82
Lentils, cooked|116|9|20.1|0.4|1 cup=198
Kidney beans, cooked|127|8.7|22.8|0.5|1 cup=177
Edamame|121|11.9|8.9|5.2|1 cup=155
Hummus|166|7.9|14.3|9.6|2 tbsp=30;1/4 cup=62
Salsa|36|1.5|7|0.2|2 tbsp=32
Guacamole|150|2|8.5|13|2 tbsp=30
Peanut butter|588|25|20|50|1 tbsp=16;2 tbsp=32
Almonds|579|21.2|21.6|49.9|1 oz (23 nuts)=28;handful=30
Walnuts|654|15.2|13.7|65.2|1 oz=28
Cashews|553|18.2|30.2|43.9|1 oz=28
Peanuts|567|25.8|16.1|49.2|1 oz=28
Mixed nuts|607|20|21|54|1 oz=28;handful=30
Chia seeds|486|16.5|42.1|30.7|1 tbsp=12
Olive oil|884|0|0|100|1 tbsp=13.5;1 tsp=4.5
Mayonnaise|680|1|0.6|75|1 tbsp=14
Ketchup|101|1|27|0.1|1 tbsp=17
Mustard|60|3.7|5.8|3.3|1 tsp=5;1 tbsp=15
BBQ sauce|172|0.8|40|0.6|1 tbsp=17;2 tbsp=34
Soy sauce|53|8|4.9|0.6|1 tbsp=16
Sriracha|93|1.9|19|0.9|1 tsp=6
Ranch dressing|430|1.3|6|44.5|2 tbsp=30
Vinaigrette|470|0|8|48|2 tbsp=30
Pesto|420|5|6|42|1 tbsp=16
Marinara sauce|50|1.4|8|1.5|1/2 cup=125
Honey|304|0.3|82.4|0|1 tbsp=21;1 tsp=7
Maple syrup|260|0|67|0.1|1 tbsp=20
Jam|278|0.4|69|0.1|1 tbsp=20
Sugar|387|0|100|0|1 tsp=4;1 tbsp=12.5
Dark chocolate, 70-85%|598|7.8|45.9|42.6|1 square=10;1 bar=100
Milk chocolate (Marabou)|535|7.6|59.4|29.7|1 row (4 squares)=25;1 bar=100
Snickers|488|7.5|61|24|1 bar=50
Gummy candy|343|6.9|77|0.2|handful=30
Lösgodis (pick and mix)|380|3|80|6|handful=30;1 bag=200
Potato chips|536|7|53|34.6|1 oz=28;handful=20;1 bag=175
Tortilla chips|489|7|64|23|1 oz=28
Pretzels|381|10.3|79.8|2.9|1 oz=28
Popcorn, air-popped|387|13|78|4.5|1 cup=8;3 cups=24
Popcorn, buttered|500|9|57|27|1 cup=11;medium bag=90
Granola bar|450|8|66|17|1 pack (2 bars)=42
Chocolate chip cookie|488|5.4|64|24|1 medium=16;1 large=60
Kanelbulle (cinnamon bun)|350|7|49|14|1 bun=90
Chokladboll|450|5|55|23|1 ball=55
Kladdkaka|430|5|50|23|1 slice=70
Semla|330|6|38|17|1 semla=150
Ice cream, vanilla|207|3.5|23.6|11|1/2 cup=66;1 scoop=70
Donut, glazed|400|5.5|48|21|1 donut=55
Blueberry muffin|377|4.4|54|16|1 muffin=113
Coffee, black|1|0.1|0|0|1 cup=240|ml
Latte|40|2.7|4|1.5|tall (12 oz)=354;grande (16 oz)=473;medium (350 ml)=350|ml
Cappuccino|27|1.7|2.6|1|tall (12 oz)=354;grande (16 oz)=473;regular (250 ml)=250|ml
Orange juice|45|0.7|10.4|0.2|1 glass=200;1 cup=248|ml
Coca-Cola|42|0|10.6|0|1 can (330 ml)=330;1 can (12 oz)=355;1 bottle=500|ml
Diet soda / Zero|0.4|0|0.1|0|1 can (330 ml)=330;1 can (12 oz)=355|ml
Red Bull|45|0|11|0|1 can=250|ml
Beer|43|0.5|3.6|0|1 can (330 ml)=330;1 pint=473;stor stark (500 ml)=500|ml,alc
Light beer|29|0.2|1.6|0|1 can (12 oz)=355|ml,alc
Red wine|85|0.1|2.6|0|1 glass=150|ml,alc
White wine|82|0.1|2.6|0|1 glass=150|ml,alc
Vodka / spirits (40%)|231|0|0|0|1 shot (4 cl)=40;1 shot (1.5 oz)=44|ml,alc
Big Mac|251|11.4|20.5|13.7|1 burger=219
Cheeseburger (McDonald's)|252|12.6|26.9|10.9|1 burger=119
Chicken nuggets|260|14.6|15.6|15.6|6 pieces=96;1 piece=16
Burger with bun (restaurant)|260|14|18|14.5|1 burger=230
Pizza, cheese|266|11.4|33|9.7|1 slice (large pizza)=107
Pizza, pepperoni|280|12|30|12.5|1 slice (large pizza)=106
Billys Pan Pizza|240|9|26|11|1 pizza=170
Burrito (chicken, rice, beans, cheese)|210|12|24|7|1 burrito=450
Burrito bowl (chicken, rice, beans)|145|11|14|5|1 bowl=450
Taco, beef, hard shell|220|10|16|13|1 taco=78
Kebab in pita|200|11|20|8.5|1 pita=300
Falafel|333|13.3|31.8|17.8|1 piece=17;4 pieces=68
Sushi, California roll|140|4.5|24|3|8 pieces=200;1 piece=25
Sushi, salmon nigiri|150|7|23|3|1 piece=40
Poke bowl, salmon|145|8|18|4.5|1 bowl=450
Pad thai|160|7|20|6|1 plate=400
Fried rice|165|5|25|5|1 cup=140;1 plate=300
Chicken curry with rice|136|8|17|4|1 plate=450
Spaghetti bolognese|136|7|17|4.5|1 plate=400
Lasagna|164|9|15|7.5|1 piece=250
Mac and cheese|166|6|21|6.5|1 cup=200
Ramen, restaurant|114|5.5|13|4.5|1 bowl=650
Instant noodles, dry|437|9|62|17|1 package=85
Caesar salad with chicken|150|10|5|10|1 bowl=350
Turkey sandwich|178|11|20|6|1 sandwich=250
PB&J sandwich|350|12|43|15.5|1 sandwich=116
Chicken wings|289|24|1|21|1 wing=30;6 wings=180
Fried chicken drumstick|264|22|8|16|1 drumstick=75
Meatballs with mash, gravy and lingonberries|161|7|14|8.5|1 plate=400
Pytt i panna|162|6|13|9.5|1 plate=350
Ärtsoppa (pea soup)|86|6|10|2.5|1 bowl=300
Chicken noodle soup|36|2.5|3.8|1.2|1 bowl=300
`;
