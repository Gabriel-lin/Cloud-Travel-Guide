# Bluethroat sources

Everything the build (`../build.py`) reads. Generated files go to `../textures`, `../build` and `frontend/public`.

## Photos (reference only, not embedded in the GLB)

| File | Source | Author | License | Used for |
|---|---|---|---|---|
| `photos/side_upright_veronesi.jpg` | [Bluethroat ( ssp svecica ) - Alps - Italy CD5A3234.jpg](https://commons.wikimedia.org/wiki/File:Bluethroat_(_ssp_svecica_)_-_Alps_-_Italy_CD5A3234.jpg) | Francesco Veronesi | CC BY-SA 2.0 | side profile, upright stance, legs, folded wing |
| `photos/side_singing_sharp.jpg` | [Bluethroat (Luscinia svecica svecica) male Oppdal.jpg](https://commons.wikimedia.org/wiki/File:Bluethroat_(Luscinia_svecica_svecica)_male_Oppdal.jpg) | Charles J. Sharp | CC BY-SA 4.0 | side profile singing, wing feather tracts |
| `photos/head_closeup_boksorn.jpg` | [Варакушка в профиль.jpg](https://commons.wikimedia.org/wiki/File:%D0%92%D0%B0%D1%80%D0%B0%D0%BA%D1%83%D1%88%D0%BA%D0%B0_%D0%B2_%D0%BF%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D1%8C.jpg) | Алина Боксорн | CC BY 4.0 | head, bill, eye, throat feather detail |
| `photos/front34_tencate.jpg` | [Red-spotted bluethroat (Luscinia svecica) 02.jpg](https://commons.wikimedia.org/wiki/File:Red-spotted_bluethroat_(Luscinia_svecica)_02.jpg) | Bouke ten Cate | CC BY-SA 4.0 | three-quarter front, full throat pattern |
| `photos/front_singing_tailfan_tencate.jpg` | [Red-spotted bluethroat (Luscinia svecica).jpg](https://commons.wikimedia.org/wiki/File:Red-spotted_bluethroat_(Luscinia_svecica).jpg) | Bouke ten Cate | CC BY-SA 4.0 | front, singing, fanned tail |
| `photos/side_singing_tailfan_ggshrike.jpg` | [Самец Варакушки поет.jpg](https://commons.wikimedia.org/wiki/File:%D0%A1%D0%B0%D0%BC%D0%B5%D1%86_%D0%92%D0%B0%D1%80%D0%B0%D0%BA%D1%83%D1%88%D0%BA%D0%B8_%D0%BF%D0%BE%D0%B5%D1%82.jpg) | GG Shrike | CC BY-SA 4.0 | singing posture with fanned tail |
| `photos/singing_gape_shrestha.jpg` | [The singing bluethroat.jpg](https://commons.wikimedia.org/wiki/File:The_singing_bluethroat.jpg) | Prasan Shrestha | CC BY-SA 4.0 | open bill and gape colour |
| `photos/back34_norelius.jpg` | [Blåhake, Pulsujärvi sameviste, Övre Soppero, Torne lappmark, May 2018 (44519723372).jpg](https://commons.wikimedia.org/wiki/File:Bl%C3%A5hake,_Pulsuj%C3%A4rvi_sameviste,_%C3%96vre_Soppero,_Torne_lappmark,_May_2018_(44519723372).jpg) | Hans Norelius from Älvsjö, Sweden | CC BY 2.0 | upperparts and closed tail from behind |
| `photos/takeoff_rear_wings_lapa.jpg` | [Pisco-de-peito-azul, macho, a trepar a alta velocidade.. Bluethroat, male, high speed climbing.. (54277178178).jpg](https://commons.wikimedia.org/wiki/File:Pisco-de-peito-azul,_macho,_a_trepar_a_alta_velocidade.._Bluethroat,_male,_high_speed_climbing.._(54277178178).jpg) | Luiz Lapa from Oeiras, Portugal | CC BY 2.0 | upper surface of both spread wings |
| `photos/flight_upstroke_jaman.jpg` | [Bluethroat flight.jpg](https://commons.wikimedia.org/wiki/File:Bluethroat_flight.jpg) | Apu Jaman | CC BY-SA 4.0 | wing at top of upstroke, slotted primaries |
| `photos/songflight_hoebeke.jpg` | [Blauwborst-3 (15579391270).jpg](https://commons.wikimedia.org/wiki/File:Blauwborst-3_(15579391270).jpg) | yves hoebeke | CC BY-SA 2.0 | song flight, wings raised, legs dangling |
| `photos/singing_tail_cocked_chevylady.jpg` | [Blauwborst bekje open staart omhoog.jpg](https://commons.wikimedia.org/wiki/File:Blauwborst_bekje_open_staart_omhoog.jpg) | Chevylady59 | CC BY-SA 3.0 nl | singing with tail cocked vertically |

## Feather scans (textures in the GLB are cut from these)

Scientific feather collection of Wilfried Hansen, founder of the Feather Research Group (est. 1972), via [featherbase.info](https://www.featherbase.info/en/species/Luscinia/svecica). Licensed CC BY 4.0, commercial use permitted with this credit.

- `feathers/hansen_4010_flight_tail.jpg`: [4010](https://www.featherbase.info/en/specimen/4010), flight feathers H1-H10, A1-A9, tail S1-S6, coverts (female; flight/tail feathers identical in males)
- `feathers/hansen_4009_full_set.jpg`: [4009](https://www.featherbase.info/en/specimen/4009), full set incl. labelled body feathers: Kehle, Kropf, Brust, Bauch, Scheitel, Ruecken, Schulter

## Song recording (the WalkSing song, `public/audio/birds/bluethroat/song-01.wav`)

[XC1168600](https://data.biodiversitydata.nl/xeno-canto/observation/XC1168600) by Stanislas Wroza, Vadsø, Norway (Luscinia svecica svecica, song / subsong), via Xeno-canto / GBIF dataset 10.15468/qv0ksn. Licensed [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/): non-commercial use, credit the recordist and Xeno-canto.

- `audio/XC1168600-excerpt-50s.wav`: seconds 50-58 of the recording (mono, peak-normalised); the build cuts the phrase pinned in `audio/song.json` from it.
- `audio/candidates.json`: the eight recordings compared when the phrase was picked (`s00_song.search()` re-runs that comparison on downloaded files).
