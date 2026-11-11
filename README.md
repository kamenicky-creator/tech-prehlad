# Prehľad techniky

Tímový prehľad zariadení, ktoré kolegovia používajú na prácu. Každý zapíše svoje zariadenia cez formulár, jedno zariadenie na jeden riadok. Hore sú súčty, pod tým zoznam všetkých zariadení s filtrom a vyhľadávaním.

- Polia: Meno (výber zo zoznamu tímu), Druh zariadenia, Názov zariadenia, Vo vlastníctve, Preferencia
- Hore je vidieť, kto z tímu sa ešte nezapísal
- Druh zariadenia: Mobil, Notebook, Monitor, Tablet, Iné
- Vo vlastníctve: Osobné, Firemné
- Preferencia: Chcem mať vlastné s firemným zabezpečením, Chcem mať firemné
- Každý upraví a odstráni svoje zariadenia, správca všetky a môže zoznam stiahnuť ako CSV
- Funguje na počítači aj v mobile, vo svetlom aj tmavom režime

Rovnako ako HO kalendár beží prehľad na Verceli za spoločným tímovým heslom. Kolegovia nepotrebujú žiadny účet (Google, Microsoft ani Claude), stačí im adresa a heslo. Dáta sú v Google tabuľke, ku ktorej je pripojený malý server v Google Apps Scripte. Prehliadač komunikuje len s Vercelom: adresa Apps Scriptu a tímový kľúč zostávajú na serveri.

## Obsah repozitára

| Súbor | Na čo slúži |
| --- | --- |
| `index.html`, `assets/` | Samotný prehľad |
| `login.html` | Prihlasovacia stránka |
| `middleware.js` | Brána: bez prihlásenia Vercel nevydá žiadnu stránku ani dáta |
| `api/` | Prihlásenie, odhlásenie a sprostredkovanie dát (Vercel Functions) |
| `config.js` | Názov tímu a frekvencia obnovy |
| `apps-script/Code.gs` | Server, vkladá sa do Google Apps Scriptu |
| `apps-script/appsscript.json` | Nastavenie projektu, treba len pri nasadzovaní cez `clasp` |

## Nastavenie

### 1. Google tabuľka a Apps Script

1. Vytvor novú prázdnu Google tabuľku, napríklad „Prehľad techniky – dáta“. Hárky „Technika“ a „Tím“ vzniknú samé, do hárku „Tím“ potom doplň mená (pozri nižšie).
2. V tabuľke otvor **Rozšírenia › Apps Script**, obsah `Kód.gs` nahraď obsahom `apps-script/Code.gs` a ulož.
3. Tímový kľúč: hore vyber funkciu `vytvorTimovyKluc`, klikni na **Spustiť** a povoľ prístup. Kľúč nájdeš v protokole spustenia.
4. Klikni na **Nasadiť › Nové nasadenie**, typ **Webová aplikácia**:
   - Spustiť ako: **Ja**
   - Kto má prístup: **Ktokoľvek**
5. Skopíruj URL webovej aplikácie (končí na `/exec`).

Prístup „Ktokoľvek“ je potrebný, aby sa na server dostal Vercel. Bez tímového kľúča server nič neprečíta ani nezapíše.

### 2. Vercel

1. Importuj repozitár (Application Preset: **Other**, bez build príkazu).
2. V **Settings › Environment Variables** pridaj:

   | Premenná | Hodnota |
   | --- | --- |
   | `APP_PASSWORD` | tímové heslo na prihlásenie |
   | `ADMIN_PASSWORD` | heslo správcu: môže upraviť a odstrániť všetky zariadenia a stiahnuť CSV |
   | `GAS_URL` | URL webovej aplikácie z Apps Scriptu (končí na `/exec`) |
   | `GAS_KEY` | tímový kľúč z Apps Scriptu |
   | `SESSION_SECRET` | voliteľné: ľubovoľný náhodný text na podpis prihlásenia |

3. V **Deployments** pri poslednom nasadení klikni na **… › Redeploy**, aby sa premenné načítali.

### 3. Tím

Pošli kolegom adresu prehľadu a tímové heslo. Po prihlásení si každý vyberie svoje meno zo zoznamu a zapíše svoje zariadenia. Prehliadač si prihlásenie zapamätá na 30 dní. Meno sa vopred nevyberá, aby na zdieľanom počítači nezostalo meno niekoho iného.

Člen tímu môže upraviť a odstrániť len zariadenia, ktoré pridal v tom istom prehliadači. Prehliadač sa rozpozná podľa náhodného identifikátora v cookie (platí 2 roky a prežije aj odhlásenie). Kto si zmení počítač alebo vymaže cookies, svoje staršie záznamy už neupraví, požiada správcu.

Správca sa prihlási na tej istej stránke heslom z `ADMIN_PASSWORD`. Vpravo hore uvidí štítok „Správca“, môže upraviť a odstrániť všetky zariadenia a stiahnuť zoznam ako CSV.

## Dáta v Google tabuľke

Hárok **Technika** má stĺpce `id`, `meno`, `druh`, `nazov`, `vlastnictvo`, `preferencia`, `pridane`, `upravene`, `vlastnik`. Hodnoty sú zapísané čitateľne (napríklad „Mobil“, „Osobné“, „Chcem mať firemné“) a stĺpce s výberom majú rozbaľovací zoznam.

Hárok **Tím** má stĺpce `id`, `meno`, `aktivny` (rovnako ako v HO kalendári). Mená z neho sa ponúkajú vo formulári v tomto poradí. Nového kolegu pridáš novým riadkom, odchádzajúcemu nastav `aktivny` na FALSE: zmizne z výberu, jeho záznamy zostanú. Zmena sa v prehľade prejaví do minúty.

Tabuľku môžeš upravovať aj ručne, prehľad zmeny načíta do minúty. Ručne pridaný riadok bez `id` dostane `id` automaticky pri ďalšom načítaní a v prehľade ho môže meniť len správca. Stĺpce `id` a `vlastnik` neupravuj.

## Bežná údržba

- **Zmena hesla:** zmeň `APP_PASSWORD` alebo `ADMIN_PASSWORD` a daj Redeploy. Všetci sa musia prihlásiť znova, svoje záznamy budú môcť upravovať ďalej.
- **Odhlásenie všetkých bez zmeny hesla:** zmeň `SESSION_SECRET` a daj Redeploy.
- **Zmena tímového kľúča:** spusti znova `vytvorTimovyKluc`, nový kľúč vlož do `GAS_KEY` a daj Redeploy.
- **Úprava servera:** po zmene `Code.gs` otvor **Nasadiť › Spravovať nasadenia**, uprav existujúce nasadenie a zvoľ **Nová verzia**. URL zostane rovnaká.
- **Úprava stránky:** stačí zmena vo vetve `main`, Vercel ju nasadí sám.
- **Frekvencia obnovy:** `pollSeconds` v `config.js` (predvolene 60 sekúnd, minimum 20). Prehľad sa obnoví aj pri návrate na kartu.

## Skúšanie bez servera

Na úpravy vzhľadu nastav v `config.js` dočasne `apiUrl: ''` a otvor `index.html`. Prehľad potom ukladá zmeny len do tvojho prehliadača.
