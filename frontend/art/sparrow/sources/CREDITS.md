# Eurasian Tree Sparrow sources

Everything the build (`../build.py`) reads. Generated files go to `../textures`, `../build` and `frontend/public`.

## Photos

Reference photos. Wing, back and tail colour is projected from `side_profile_halun.jpg` (via the `_birdfill.png` copy, background filled from the bird edge, and `_bgmask.png`) and baked into `build/feathers_baked.png`, which is embedded in the GLB. The other photos are used only as references.

| File | Source | Author | License | Used for |
|---|---|---|---|---|
| `photos/side_profile_halun.jpg` | [Eurasian tree sparrow, Rżuchów, Świętokrzyskie Voivodeship, 20250421 1151 4165.jpg](https://commons.wikimedia.org/wiki/File:Eurasian_tree_sparrow,_R%C5%BCuch%C3%B3w,_%C5%9Awi%C4%99tokrzyskie_Voivodeship,_20250421_1151_4165.jpg) | Jakub Hałun | CC BY 4.0 | side profile on a flat wall top: traced silhouette, landmarks, plumage map |
| `photos/front34_halun.jpg` | [Eurasian tree sparrow, Rżuchów, Świętokrzyskie Voivodeship, 20250421 1151 4164.jpg](https://commons.wikimedia.org/wiki/File:Eurasian_tree_sparrow,_R%C5%BCuch%C3%B3w,_%C5%9Awi%C4%99tokrzyskie_Voivodeship,_20250421_1151_4164.jpg) | Jakub Hałun | CC BY 4.0 | three-quarter front: bib width, white collar, breast colour |
| `photos/head_closeup_othagoer.jpg` | [Passer montanus malaccensis @ Kuala Lumpur, Malaysia (1).jpg](https://commons.wikimedia.org/wiki/File:Passer_montanus_malaccensis_@_Kuala_Lumpur,_Malaysia_(1).jpg) | Peter P. Othagoer | CC BY 4.0 | head close-up: bill shape, ear spot, crown, eye |
| `photos/side_perched_laitche.jpg` | [Tree Sparrow August 2007 Osaka Japan.jpg](https://commons.wikimedia.org/wiki/File:Tree_Sparrow_August_2007_Osaka_Japan.jpg) | Laitche | Public domain | side profile: wing bars, mantle streaks, tail length |
| `photos/side_perched_kiran.jpg` | [Tree Sparrow (Passer montanus), Nepal 02.jpg](https://commons.wikimedia.org/wiki/File:Tree_Sparrow_(Passer_montanus),_Nepal_02.jpg) | Nrik kiran | CC BY-SA 4.0 | side profile, relaxed posture, legs and feet |
| `photos/rear34_laitche.jpg` | [Eurasian tree sparrow at Tennōji Park in Osaka, December 2015.jpg](https://commons.wikimedia.org/wiki/File:Eurasian_tree_sparrow_at_Tenn%C5%8Dji_Park_in_Osaka,_December_2015.jpg) | Laitche | CC BY-SA 4.0 | upperparts from behind: crown/nape, white collar, streaked mantle |
| `photos/calling_open_bill_hedera.jpg` | [Mommy, someone's taking my pictures! (29634405956).jpg](https://commons.wikimedia.org/wiki/File:Mommy,_someone%27s_taking_my_pictures!_(29634405956).jpg) | hedera.baltica from Wrocław, Poland | CC BY-SA 2.0 | calling with bill wide open (young bird): Call clip posture |
| `photos/ground_forage_food_halun.jpg` | [Eurasian tree sparrow, Rżuchów, Świętokrzyskie Voivodeship, 20250421 1149 4157.jpg](https://commons.wikimedia.org/wiki/File:Eurasian_tree_sparrow,_R%C5%BCuch%C3%B3w,_%C5%9Awi%C4%99tokrzyskie_Voivodeship,_20250421_1149_4157.jpg) | Jakub Hałun | CC BY 4.0 | foraging on grass with food in the bill: HopForage clip |
| `photos/ground_forage_hedera.jpg` | [Tree sparrow (30669122986).jpg](https://commons.wikimedia.org/wiki/File:Tree_sparrow_(30669122986).jpg) | hedera.baltica from Wrocław, Poland | CC BY-SA 2.0 | crouched forager on the ground |
| `photos/ground_peck_hedera.jpg` | [Tree sparrow (49496061302).jpg](https://commons.wikimedia.org/wiki/File:Tree_sparrow_(49496061302).jpg) | hedera.baltica from Wrocław, Poland | CC BY-SA 2.0 | pecking on the ground: HopForage peck posture |
| `photos/ground_grass_hedera.jpg` | [Tree sparrow (33983422078).jpg](https://commons.wikimedia.org/wiki/File:Tree_sparrow_(33983422078).jpg) | hedera.baltica from Wrocław, Poland | CC BY-SA 2.0 | ground posture, tail held low |
| `photos/ground_pair_gerifalte.jpg` | [Passer montanus at KL (2).jpg](https://commons.wikimedia.org/wiki/File:Passer_montanus_at_KL_(2).jpg) | GerifalteDelSabana | CC BY-SA 4.0 | two birds on paving, hopping gait |
| `photos/flight_spread_mildeep.jpg` | [Eurasian-Tree-Sparrow.jpg](https://commons.wikimedia.org/wiki/File:Eurasian-Tree-Sparrow.jpg) | Mildeep | CC BY-SA 4.0 | flight, wings fully spread: upper wing pattern |
| `photos/flight_pair_pavadk.jpg` | [Vrabec polný.jpg](https://commons.wikimedia.org/wiki/File:Vrabec_poln%C3%BD.jpg) | Pavadk | CC BY-SA 4.0 | flight, downstroke and fanned tail, legs tucked |
| `photos/flight_hover_arquus.jpg` | [Feldsperling im Regen.jpg](https://commons.wikimedia.org/wiki/File:Feldsperling_im_Regen.jpg) | Arquus | CC BY-SA 4.0 | flight with blurred wings: wingbeat amplitude |
| `photos/flight_lam.jpg` | [Flying (5861266205).jpg](https://commons.wikimedia.org/wiki/File:Flying_(5861266205).jpg) | Charles Lam from Hong Kong, China | CC BY-SA 2.0 | flight from the side: body angle in flapping flight |
| `photos/specimen_naturalis.jpg` | [Naturalis Biodiversity Center - RMNH.AVES.104500 - Passer montanus montanus (Linnaeus, 1758) - Ploceidae - bird skin specimen.jpeg](https://commons.wikimedia.org/wiki/File:Naturalis_Biodiversity_Center_-_RMNH.AVES.104500_-_Passer_montanus_montanus_(Linnaeus,_1758)_-_Ploceidae_-_bird_skin_specimen.jpeg) | Linnaeus, 1758 | CC BY-SA 3.0 | museum skin RMNH.AVES.104500: measurements, plumage layout |

Derived files: `photos/side_profile_halun_birdfill.png/.jpg` and `photos/side_profile_halun_bgmask.png` are made from Jakub Hałun's photo and carry the same CC BY 4.0 licence.

## Feather scans (feather shapes, barbs and vanes in the GLB are cut from these)

Scientific feather collection of Wilfried Hansen, founder of the Feather Research Group (est. 1972), via [featherbase.info](https://www.featherbase.info/). Licensed CC BY 4.0; commercial use is permitted with this credit. The scans are bluethroat (*Luscinia svecica*) feathers, used for feather shape and structure. Tree-sparrow colour comes from the photos above.

- `feathers/hansen_4010_flight_tail.jpg`: [4010](https://www.featherbase.info/en/specimen/4010), flight feathers, tail and coverts
- `feathers/hansen_4009_full_set.jpg`: [4009](https://www.featherbase.info/en/specimen/4009), full set including body feathers

## Call recording (the Call clip, `public/audio/birds/sparrow/tree-sparrow-call-01.wav`)

[XC776834](https://data.biodiversitydata.nl/xeno-canto/observation/XC776834) by Sonothèque ADVL, France (*Passer montanus*, adult calls near the nest), via Xeno-canto / GBIF dataset 10.15468/qv0ksn. Licensed [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication); crediting the recordist and Xeno-canto is still appreciated.

- `audio/XC776834-excerpt-25s.wav`: seconds 25-31 of the recording (mono 44.1 kHz, peak-normalised). The build cuts the phrase pinned in `audio/song.json` from it.

## Flight kinematics (Fly clip, `pipeline/s09_anim.py`)

These are not embedded in the GLB. They set the wingbeat, stroke and flap-bound parameters.

- Tobalske, B. W. (2001). Morphology, velocity, and intermittent flight in birds. *American Zoologist* 41:177-187, [doi:10.1093/icb/41.2.177](https://doi.org/10.1093/icb/41.2.177). Small passerines with low-aspect-ratio wings flap-bound at all speeds; during bounds the wings are flexed against the body.
- Tobalske, B. W., Peacock, W. L. & Dial, K. P. (1999). Kinematics of flap-bounding flight in the zebra finch over a wide range of speeds. *J. Exp. Biol.* 202:1725-1739. Sets the stroke amplitude (~100-130 deg), the downstroke share (~55 %), the flexed "tip-reversal" upstroke, and the short bursts of beats between bounds.
- House-sparrow take-off wingbeat frequency of 22.4 Hz: *Ornithology* 143(1), 2025, "Tags temporarily decrease takeoff velocity and trajectory in *Passer domesticus*", [doi:10.1093/ornithology/ukaf046](https://doi.org/10.1093/ornithology/ukaf046).
- Sibley, D. "Identifying small songbirds by flight style" (sibleyguides.com). House sparrow flight: bursts of quick wingbeats with short freefalls and little undulation.
- Reference photos above: `flight_spread_mildeep.jpg`, `flight_pair_pavadk.jpg`, `flight_hover_arquus.jpg`, `flight_lam.jpg`.

At 30 fps a true 20-24 Hz beat falls between frames, so the clip uses a 10 Hz beat (3 frames per beat), half the real rate. The other parameters follow the sources above.
