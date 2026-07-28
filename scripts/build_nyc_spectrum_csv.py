import csv
import re
from collections import Counter
from pathlib import Path

SOURCE = Path(r"c:\Users\UMAR-\Downloads\ustv-channels(1).csv")
SPECTRUM_FILE = Path(
    r"C:\Users\UMAR-\.cursor\projects\e-CURSOR-M3U-LIST-GEN\agent-tools\9153be2c-17e2-40e6-a01d-27745bda2cb3.txt"
)
OUTPUT = Path(r"E:\CURSOR\M3U-LIST-GEN\nyc-public-channels.csv")

LATINO = re.compile(
    r"univision|telemundo|unimas|uni\s*mas|estrella|galavisi|nbc universo|universo|espn deportes|"
    r"fox deportes|cnn en espa|deportes|en espa|spanish|hispanic|latino|noticias ny1|spectrum noticias|"
    r"azteca|latv|telenor|canal 24|canal once|tele n|mexicanal|pasiones|tlnovelas|telehit|bandamax|"
    r"forotv|hitn|aplauzo|viendomovies|cine latino|de pelicula|ultra |semillitas|isorpresa|atres series|"
    r"babyfirst americas|discovery en espa|nat geo mundo|history channel en espa|ewtn spanish|tbn enlace|"
    r"aym sports|tr3s|mtv tr3|mtv flow latino|wnyn|wasa|kmex|kuvn|wltv|wfut|wxtv|wnju|video rola|v-me|"
    r"caracol|wapa america|cuba play|antena 3 internacional|tve sd|teleformula|multimedios|"
    r"centroamericatv|tele el salvador|televisi[oó]n dominicana|telemicro|super canal|"
    r"pluto tv novelas|nickelodeon en espa|amc en espa|daystar espa|showtime en espa|cinemax spanish|hbo latino|cbn espanol",
    re.I,
)
EXCLUDE = re.compile(
    r"AlbDreams|ARTN TV|CAN TV|CoastTV|Brookline|Springfield|Celebrity Scene|NTD TV|Armenia|Amga TV|"
    r"AssyriaSat|Asian Culture|Alhurra|Filipino|Korean Channel|Jus Punjabi|Jus Hindi|Chinese Cinema|"
    r"Sino TV|TV Japan|KBS World|NDTV|HarPal|Albdreams|Access Media|AuroraTV|Akaku|"
    r"Legislative|Government Access|City of |County |Community Media Channel \d|Channel 18 GAC|"
    r"Cerritos|KMSP|ARY Digital|CBN Espanol|BIG Civic|Women's Sports Network|"
    r"\bWest\b.*\b(Bravo|BET|A&E|FX|FXX|Lifetime|Paramount|SYFY|USA Network|VH1|MTV|Comedy Central)\b",
    re.I,
)
JUNK = re.compile(r"like Gecko\)|group-title=", re.I)
OUT_OF_MARKET = re.compile(
    r"\bABC \d+\b|\bCBS \d+\b|\bNBC \d+\b|\bFOX \d+\b|\bFox \d+\b|"
    r"Portland|Boston|Seattle|Charleston|Denver|Phoenix|Milwaukee|Las Vegas|Austin|Columbus|"
    r"Albuquerque|Washington DC|Tucson|San Diego|Asheville|Myrtle Beach|Dayton|Bakersfield|"
    r"Baltimore|Indianapolis|Manchester|Orlando|Tallahassee|Miami|Providence|Rochester|"
    r"Albany|Green Bay|Chicago|Johnstown|Santa Barbara|Lima|Salinas|Steubenville|"
    r"Salt Lake|Kalamazoo|Omaha|El Paso|Richmond|Des Moines|Oklahoma|Cincinnati|Palm Beach|"
    r"Harrisburg|South Bend|San Francisco|Cape Girardeau|Visalia|Corpus Christi|Los Angeles",
    re.I,
)
NYC_LOCAL = re.compile(
    r"WCBS|WNBC|WNYW|WWOR|WABC|WPIX|WNET|WLIW|WPXN|WJLP|WLNY|WMBC|WRNN|WNYE|WXTV|WFUT|WNJU|"
    r"News ?12|BronxNet|BX |NYXT|White Plains|MNN|CUNY|NYC TV|News12|CBS News New York",
    re.I,
)

PRIORITY_IDS = [
    "WCBSTV21.us@HD",
    "WNBC471.us@HD",
    "WNYW51.us@HD",
    "WWORTV91.us@HD",
    "WMBCTV631.us@HD",
    "ABC.us@East",
    "CBS.us@East",
    "NBC.us@East",
    "Fox.us@East",
    "CW.us@East",
    "IONTV.us@East",
    "MeTV.us@SD",
    "MeTVPlus.us@SD",
    "AntennaTV.us@SD",
    "CoziTV.us@SD",
    "Localish.us@SD",
    "StartTV.us@SD",
    "Buzzr.us@SD",
    "Movies.us@SD",
    "Bounce.us@SD",
    "Comet.us@SD",
    "Charge.us@SD",
    "Laff.us@SD",
    "Grit.us@SD",
    "FETV.us@SD",
    "Roar.us@SD",
    "BounceXL.us@SD",
    "GritXtra.us@SD",
    "CBSNewsNewYork.us@SD",
    "News12NewYork.us@SD",
    "News12Bronx.us@SD",
    "News12Brooklyn.us@SD",
    "News12Westchester.us@SD",
    "News12PlusNewYork.us@HD",
    "News12PlusNewJersey.us@HD",
    "News12PlusLongIsland.us@HD",
    "WhitePlainsCommunityMedia.us@SD",
    "i24NEWSEnglishUSA.il@SD",
    "FoxNewsChannel.us@SD",
    "MSNOW.us@SD",
    "NBCNewsNOW.us@SD",
    "ABCNewsLive1.us@SD",
    "CBSNews247.us@SD",
    "CNBC.us@SD",
    "FoxBusinessNetwork.us@SD",
    "BloombergTV.us@US",
    "CheddarNews.us@SD",
    "CheddarBusiness.us@SD",
    "LiveNOWfromFOX.us@SD",
    "ScrippsNews.us@SD",
    "NewsNation.us@SD",
    "NewsmaxTV.us@SD",
    "Newsmax2.us@SD",
    "TODAYAllDay.us@SD",
    "CSPAN.us@SD",
    "CSPAN2.us@SD",
    "FreeSpeechTV.us@SD",
    "OANPlus.us@SD",
    "OneAmericaNewsNetwork.us@SD",
    "BlazeLive.us@SD",
    "Newsy.us@SD",
    "ReutersTV.us@SD",
    "AccuWeatherNetwork.us@SD",
    "AccuWeatherNOW.us@SD",
    "FoxWeather.us@SD",
    "SportsNetNewYork.us@SD",
    "MSG.us@SD",
    "MSG2.us@SD",
    "MSGPlus.us@SD",
    "YesNetwork.us@SD",
    "ESPNU.us@SD",
    "ESPNews.us@SD",
    "NFLNetwork.us@SD",
    "MLBNetwork.us@SD",
    "MLBStrikeZone.us@SD",
    "NBATV.us@SD",
    "NHLNetwork.us@SD",
    "FoxSports1.us@HD",
    "FoxSports2.us@HD",
    "CBSSportsNetworkUSA.us@SD",
    "CBSSportsHQ.us@SD",
    "NBCSportsNOW.us@SD",
    "NBCSN.us@SD",
    "GolfChannel.us@SD",
    "TennisChannel.us@SD",
    "ACCNetwork.us@SD",
    "SECNetwork.us@SD",
    "BigTenNetwork.us@SD",
    "FanDuelTV.us@SD",
    "FanDuelRacing.us@SD",
    "beINSportsUSA.us@SD",
    "beINSPORTSXTRA.us@SD",
    "FoxSoccerPlus.us@SD",
    "Willow.us@SD",
    "WillowSports.us@SD",
    "OutdoorChannel.us@HD",
    "DraftKingsNetwork.us@SD",
    "Pac12Insider.us@SD",
    "Stadium.us@SD",
    "SportsGrid.us@SD",
    "Nickelodeon.us@East",
    "FX.us@East",
    "Oxygen.us@East",
    "USANetwork.us@East",
    "SYFY.us@East",
    "Bravo.us@East",
    "VH1.us@East",
    "MTV.us@East",
    "MTV2.us@East",
    "AE.us@East",
    "E.us@East",
    "ComedyCentral.us@East",
    "Lifetime.us@East",
    "LifetimeMovies.us@East",
    "ParamountNetwork.us@East",
    "HallmarkChannel.us@East",
    "HallmarkMystery.us@East",
    "AMC.us@EastHD",
    "BET.us@East",
    "BETHer.us@East",
    "GameShowNetwork.us@East",
    "BBCAmerica.us@EastHD",
    "IONPlus.us@East",
    "Freeform.us@East",
    "TVLand.us@East",
    "SundanceTV.us@East",
    "IFC.us@East",
    "FXX.us@East",
    "FXMovieChannel.us@SD",
    "Logo.us@East",
    "UpTV.us@SD",
    "INSP.us@SD",
    "TVOne.us@SD",
    "Fuse.us@East",
    "Revolt.us@SD",
    "Aspire.us@SD",
    "CleoTV.us@SD",
    "VICETV.us@SD",
    "FYI.us@East",
    "Ovation.us@SD",
    "Reelz.us@SD",
    "GreatAmericanFamily.us@SD",
    "CMT.us@East",
    "AXSTV.us@SD",
    "History.us@East",
    "NationalGeographic.us@East",
    "NationalGeographicWild.us@East",
    "CrimePlusInvestigation.us@SD",
    "CourtTV.us@SD",
    "LawCrime.us@SD",
    "SmithsonianChannel.us@East",
    "DiscoveryTurbo.us@SD",
    "PlutoTVTrueCrime.us@US",
    "PlutoTVHistory.us@US",
    "PlutoTVScience.us@US",
    "DisneyChannel.us@East",
    "DisneyJunior.us@East",
    "DisneyXD.us@East",
    "NickJr.us@East",
    "Nicktoons.us@East",
    "TeenNick.us@East",
    "BabyFirst.us@US",
    "PBSKids247.us@SD",
    "PBSKidsEasternCentral.us@SD",
    "PBS.us@East",
    "WNJT521.us@HD",
    "FNX.us@SD",
    "Showtime.us@East",
    "Showtime2.us@East",
    "ShowtimeExtreme.us@East",
    "ShowtimeNext.us@East",
    "ShowtimeFamilyZone.us@East",
    "Starz.us@East",
    "StarzEdge.us@East",
    "StarzEncore.us@East",
    "StarzComedy.us@East",
    "StarzCinema.us@East",
    "StarzKidsFamily.us@East",
    "MGMPlus.us@East",
    "MGMPlusDriveIn.us@SD",
    "MovieSphere.us@US",
    "TBN.us@East",
    "TBNInspire.us@SD",
    "EWTN.us@English",
    "DaystarTV.us@SD",
    "TheWordNetwork.us@SD",
    "ImpactNetwork.us@SD",
    "QVC.us@SD",
    "QVC2.us@SD",
    "QVC3.us@SD",
    "HSN.us@East",
    "HSN2.us@SD",
    "ShopLC.us@SD",
    "BXInform.us@SD",
    "BXInspire.us@SD",
    "BXOmni.us@SD",
    "BXArts.us@SD",
    "BXCulture.us@SD",
    "NYXT.us@SD",
    "FoxSoul.us@SD",
    "JewishLifeTelevision.us@SD",
    "BYUTV.us@SD",
    "RFDTV.us@SD",
    "TheCowboyChannel.us@SD",
]

ALLOW_CATEGORIES = {
    "Entertainment",
    "Sports",
    "News",
    "Movies",
    "Kids",
    "Documentary",
    "Lifestyle",
    "Comedy",
    "Classic",
    "Business",
    "Weather",
    "Family",
    "Music",
    "Religious",
    "Shop",
    "Culture",
    "Outdoor",
    "Auto",
    "Science",
    "Animation",
    "Series",
}

FAST_PICKS = [
    "PlutoTVGameShows.us@SD",
    "PlutoTVAction.us@US",
    "PlutoTVCrimeDrama.us@SD",
    "PlutoTVCrimeMovies.us@SD",
    "PlutoTVDrama.us@US",
    "PlutoTVHorror.us@US",
    "PlutoTVSciFi.us@US",
    "PlutoTVWesterns.us@US",
    "PlutoTVCompetition.us@SD",
    "PlutoTVParanormal.us@US",
    "PlutoTVBackcountry.us@SD",
    "PlutoTVMilitary.us@SD",
    "PlutoTVHometownDrama.us@SD",
    "PlutoTVAnime.us@US",
    "MeTVToons.us@SD",
    "NickelodeonPlutoTV.us@SD",
    "ComedyCentralPlutoTV.us@US",
    "MTVPlutoTV.us@US",
    "CBSSportsGolazoNetwork.us@SD",
    "FuboSportsNetwork.us@SD",
    "WorldPokerTour.us@US",
    "BellatorMMA.us@SD",
    "NHRATV.us@SD",
    "PGATour.us@SD",
    "RallyTV.us@SD",
    "TVSSports.us@SD",
    "Unbeaten.us@SD",
    "HallmarkMoviesMore.us@SD",
    "HallmarkFamily.us@SD",
    "ParamountMovieChannel.us@SD",
    "FXM.us@East",
    "AMCPlus.us@SD",
    "StoriesbyAMC.us@SD",
    "AllBLKGems.us@SD",
]

NATIONAL_HINTS = re.compile(
    r"^(ABC|CBS|NBC|Fox|CW|ION|MeTV|Pluto TV|TNT|TBS|ESPN|CNN|HLN|USA Network|SYFY|Bravo|FX|FXX|"
    r"Nickelodeon|Disney|Hallmark|History|Discovery|Nat Geo|Animal Planet|Travel|Food Network|HGTV|TLC|"
    r"Cartoon|Boomerang|Showtime|Starz|MGM|Paramount|Comedy Central|MTV|VH1|BET|A&E|Lifetime|AMC|"
    r"BBC America|TV Land|Sundance|IFC|Ovation|REELZ|Court TV|Law & Crime|Smithsonian|Outdoor|"
    r"QVC|HSN|TBN|EWTN|Daystar|Bloomberg|CNBC|Fox News|Fox Business|Newsmax|NewsNation|C-SPAN|"
    r"AccuWeather|Fox Weather|MSG|SNY|YES|NFL|MLB|NBA|NHL|Golf|Tennis|SEC|ACC|Big Ten|"
    r"Bounce|Grit|Laff|Charge|Comet|Cozi|Start TV|Buzzr|Movies!|Antenna|Freeform|Game Show|"
    r"Crime \+|Investigation|Destination America|Science Channel|American Heroes|Military|"
    r"FanDuel|Willow|beIN Sports|Fox Sports|CBS Sports|NBC Sports|ESPNews|ESPNU|"
    r"Great American|Up TV|INSP|TV One|Revolt|Aspire|Cleo|VICE|FYI|Fuse|Logo|Pop |CMT|AXS|"
    r"RFD|Cowboy|BYU|Impact Network|Word Network|MovieSphere|DraftKings|Pac-12|Stadium|SportsGrid)",
    re.I,
)

CATEGORY_RULES = [
    (re.compile(r"News12|CBS News New York|White Plains|i24", re.I), "Local News"),
    (
        re.compile(
            r"Nickelodeon|FX|Oxygen|USA Network|SYFY|Bravo|VH1|MTV|A&E|Lifetime|Paramount Network|"
            r"Hallmark Channel|AMC|BET|Game Show|BBC America|Freeform|TV Land|Sundance|IFC|FXX|Logo|"
            r"Up TV|INSP|TV One|Fuse|Revolt|Aspire|Cleo|VICE|FYI|Ovation|CMT|AXS|Comedy Central|"
            r"Great American|Pop |TV One|Women's Sports|AWE|WGN",
            re.I,
        ),
        "Entertainment",
    ),
    (re.compile(r"WCBS|WNBC|WNYW|WWOR|WMBC", re.I), "Local NYC"),
    (
        re.compile(
            r"ABC\.us|CBS\.us|NBC\.us|Fox\.us|CW\.us|ION|MeTV|Antenna|Cozi|Start TV|Buzzr|Movies!|Bounce|Comet|Charge|Laff|Grit|FETV|Roar|Localish",
            re.I,
        ),
        "Broadcast",
    ),
    (re.compile(r"Bronx|BX |NYXT", re.I), "NYC Community"),
    (re.compile(r"PBS|WNJT|FNX", re.I), "Public TV"),
    (re.compile(r"Disney|Nick|TeenNick|BabyFirst|PBS Kids|Cartoon|MeTV Toons", re.I), "Kids"),
    (
        re.compile(
            r"SNY|MSG|YES|ESPN|ESP|NFL|MLB|NBA|NHL|Fox Sports|CBS Sports|NBC Sports|Golf|Tennis|ACC|SEC|Big Ten|FanDuel|beIN|Willow|Outdoor|DraftKings|Pac|Stadium|SportsGrid|Soccer|MMA|NHRA|PGA|Rally|Fubo|Golazo|Strike Zone|Cowboy|TVG",
            re.I,
        ),
        "Sports",
    ),
    (re.compile(r"AccuWeather|Fox Weather|Weather", re.I), "Weather"),
    (
        re.compile(
            r"Fox News|MS NOW|MSNBC|CNN|HLN|CNBC|Bloomberg|Cheddar|News|C-SPAN|Reuters|OAN|Blaze|Free Speech|Newsy|TODAY|Scripps|Newsmax|NewsNation|i24",
            re.I,
        ),
        "News",
    ),
    (
        re.compile(
            r"Showtime|Starz|MGM|MovieSphere|Pluto TV|Hallmark Movies|Paramount Movie|FXM|AMC Plus|Charge|Movies!",
            re.I,
        ),
        "Movies",
    ),
    (re.compile(r"TBN|EWTN|Daystar|Word Network|Impact Network|Jewish Life|BYU", re.I), "Religious"),
    (re.compile(r"QVC|HSN|Shop LC", re.I), "Shop"),
    (
        re.compile(
            r"History|Nat Geo|Smithsonian|Crime|Court TV|Law & Crime|Discovery|Outdoor|Pluto TV True|Pluto TV History|Pluto TV Science|Pluto TV Paranormal|REELZ",
            re.I,
        ),
        "Documentary",
    ),
    (re.compile(r"CMT|AXS|MTV|VH1|Music", re.I), "Music"),
    (re.compile(r"FYI|Cleo|Lifestyle|RFD", re.I), "Lifestyle"),
    (re.compile(r"TV Land|Classic", re.I), "Classic"),
    (re.compile(r"Comedy", re.I), "Comedy"),
    (re.compile(r"Auto|MotorTrend|Pluto TV Cars", re.I), "Auto"),
]


def parse_spectrum_names():
    names = []
    if not SPECTRUM_FILE.exists():
        return names
    for line in SPECTRUM_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = re.match(
            r"^\|\s*(.+?)\s*\|\s*(Local|Entertainment|News|Sports|Kids|Documentary|Lifestyle|Shopping|Religious|Premium|Music|Business|Weather|Classic|Comedy|Family|Outdoor|Auto|Science|Shop)\s*\|",
            line,
        )
        if not match:
            continue
        name = re.sub(r"\s+(SD|HD)\s*$", "", match.group(1).strip(), flags=re.I)
        if any(
            x in name.lower()
            for x in [
                "espa",
                "spanish",
                "latino",
                "univision",
                "telemundo",
                "unimas",
                "estrella",
                "azteca",
                "tudn",
                "deportes",
                "tlnovelas",
                "tr3s",
                "forotv",
                "hitn",
                "mexicanal",
            ]
        ):
            continue
        names.append(name)
    seen = set()
    unique = []
    for name in names:
        key = re.sub(r"[^a-z0-9]+", "", name.lower())
        if key not in seen:
            seen.add(key)
            unique.append(name)
    return unique


def parse_spectrum_category_map():
    category_map = {}
    if not SPECTRUM_FILE.exists():
        return category_map
    for line in SPECTRUM_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = re.match(
            r"^\|\s*(.+?)\s*\|\s*(Local|Entertainment|News|Sports|Kids|Documentary|Lifestyle|Shopping|Religious|Premium|Music|Business|Weather|Classic|Comedy|Family|Outdoor|Auto|Science|Shop)\s*\|",
            line,
        )
        if not match:
            continue
        name = re.sub(r"\s+(SD|HD)\s*$", "", match.group(1).strip(), flags=re.I)
        category = match.group(2)
        key = re.sub(r"[^a-z0-9]+", "", name.lower())
        category_map[key] = category
    return category_map


SPECTRUM_CATEGORY_MAP = parse_spectrum_category_map()

EXACT_CATEGORY_BY_TVG = {
    "WCBSTV21.us@HD": "Local NYC",
    "WNBC471.us@HD": "Local NYC",
    "WNYW51.us@HD": "Local NYC",
    "WWORTV91.us@HD": "Local NYC",
    "WMBCTV631.us@HD": "Local NYC",
    "CBSNewsNewYork.us@SD": "Local News",
    "News12NewYork.us@SD": "Local News",
    "News12Bronx.us@SD": "Local News",
    "News12Brooklyn.us@SD": "Local News",
    "News12Westchester.us@SD": "Local News",
    "News12PlusNewYork.us@HD": "Local News",
    "News12PlusNewJersey.us@HD": "Local News",
    "News12PlusLongIsland.us@HD": "Local News",
    "WhitePlainsCommunityMedia.us@SD": "Local News",
    "BXInform.us@SD": "NYC Community",
    "BXInspire.us@SD": "NYC Community",
    "BXOmni.us@SD": "NYC Community",
    "BXArts.us@SD": "NYC Community",
    "BXCulture.us@SD": "NYC Community",
    "NYXT.us@SD": "NYC Community",
    "PBS.us@East": "Public TV",
    "WNJT521.us@HD": "Public TV",
    "FNX.us@SD": "Public TV",
    "PBSKids247.us@SD": "Kids",
    "PBSKidsEasternCentral.us@SD": "Kids",
    "CNBC.us@SD": "News",
    "FoxBusinessNetwork.us@SD": "News",
    "LiveNOWfromFOX.us@SD": "News",
    "NewsNation.us@SD": "News",
    "FreeSpeechTV.us@SD": "News",
    "AccuWeatherNetwork.us@SD": "Weather",
    "AccuWeatherNOW.us@SD": "Weather",
    "FoxWeather.us@SD": "Weather",
    "beINSportsUSA.us@SD": "Sports",
    "beINSPORTSXTRA.us@SD": "Sports",
    "BloombergTV.us@US": "News",
    "CheddarBusiness.us@SD": "Business",
    "Reelz.us@SD": "Entertainment",
    "NationalGeographic.us@East": "Documentary",
    "NationalGeographicWild.us@East": "Documentary",
    "CrimePlusInvestigation.us@SD": "Documentary",
    "DiscoveryTurbo.us@SD": "Documentary",
    "MovieSphere.us@US": "Movies",
    "TBNInspire.us@SD": "Religious",
    "ImpactNetwork.us@SD": "Religious",
    "JewishLifeTelevision.us@SD": "Religious",
    "FoxSoul.us@SD": "Entertainment",
    "IONPlus.us@East": "Entertainment",
    "WFXT662.us@SD": "Broadcast",
}

SOURCE_CATEGORY_FALLBACK = {
    "News": "News",
    "Sports": "Sports",
    "Movies": "Movies",
    "Kids": "Kids",
    "Documentary": "Documentary",
    "Lifestyle": "Lifestyle",
    "Religious": "Religious",
    "Music": "Music",
    "Business": "Business",
    "Weather": "Weather",
    "Family": "Kids",
    "Animation": "Kids",
    "Education": "Public TV",
    "Comedy": "Entertainment",
    "Classic": "Entertainment",
    "Outdoor": "Sports",
    "Shop": "Shop",
    "Cooking": "Lifestyle",
    "Science": "Documentary",
    "Auto": "Documentary",
    "Series": "Entertainment",
    "Culture": "Entertainment",
}


def spectrum_category_for_name(name):
    key = re.sub(r"\s+(SD|HD)\s*$", "", name, flags=re.I)
    key = re.sub(r"\([^)]*\)", "", key)
    key = re.sub(r"[^a-z0-9]+", "", key.lower())
    return SPECTRUM_CATEGORY_MAP.get(key)


def assign_category(row):
    tvg = row["tvg_id"]
    name = row["name"]

    if tvg in EXACT_CATEGORY_BY_TVG:
        return EXACT_CATEGORY_BY_TVG[tvg]

    if re.search(r"ABC\.us|CBS\.us|NBC\.us|Fox\.us|CW\.us|MeTV|Antenna|Cozi|Start TV|Buzzr|Movies!|Bounce|Comet|Charge|Laff|Grit|FETV|Roar|Localish", tvg + " " + name, re.I):
        return "Broadcast"

    spectrum_cat = spectrum_category_for_name(name)
    if spectrum_cat:
        if spectrum_cat == "Local":
            if re.search(r"PBS|FNX|WNET|WLIW|WNJN", name, re.I):
                return "Public TV"
            if re.search(r"News ?12|CBS News New York|White Plains", name, re.I):
                return "Local News"
            if re.search(r"BX |Bronx|NYXT|MNN|CUNY|NYC TV", name, re.I):
                return "NYC Community"
            return "Broadcast"
        if spectrum_cat == "Shopping":
            return "Shop"
        if spectrum_cat == "Premium":
            return "Movies"
        return spectrum_cat

    text = name + " " + tvg
    for rx, newcat in CATEGORY_RULES:
        if rx.search(text):
            return newcat

    return SOURCE_CATEGORY_FALLBACK.get(row["category"], "Entertainment")


def main():
    all_rows = {}
    with SOURCE.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tvg = row["tvg_id"].strip()
            name = row["name"]
            if (
                JUNK.search(name)
                or LATINO.search(name)
                or LATINO.search(tvg)
                or EXCLUDE.search(name)
                or row["category"] == "Legislative"
            ):
                continue
            if tvg not in all_rows:
                all_rows[tvg] = row

    selected = {}
    order = []

    def add(tvg):
        if tvg in selected:
            return
        row = all_rows.get(tvg)
        if not row:
            return
        selected[tvg] = row
        order.append(tvg)

    for tvg in PRIORITY_IDS:
        add(tvg)

    for spec in parse_spectrum_names():
        spec_norm = re.sub(r"\([^)]*\)", "", spec).strip().lower()
        spec_norm = re.sub(r"\s+(sd|hd)$", "", spec_norm)
        tokens = [
            t
            for t in re.split(r"[^a-z0-9]+", spec_norm)
            if t and t not in {"the", "sd", "hd", "channel", "network", "tv"}
        ]
        if not tokens:
            continue
        best = None
        best_score = 0
        for tvg, row in all_rows.items():
            if tvg in selected:
                continue
            text = (row["name"] + " " + tvg).lower()
            if OUT_OF_MARKET.search(row["name"]) and not NYC_LOCAL.search(row["name"]):
                continue
            score = sum(2 if tok in text else 0 for tok in tokens)
            if tokens and tokens[0] in text:
                score += 3
            if score > best_score:
                best_score = score
                best = tvg
        if best and best_score >= max(4, len(tokens) * 2):
            add(best)

    for tvg, row in all_rows.items():
        if tvg in selected:
            continue
        if row["category"] not in ALLOW_CATEGORIES:
            continue
        name = row["name"]
        if OUT_OF_MARKET.search(name) and not NYC_LOCAL.search(name):
            continue
        if not NATIONAL_HINTS.search(name):
            continue
        if re.search(r"\bWest\b", name) and not re.search(
            r"Nickelodeon|Disney|Freeform|Hallmark|Lifetime|Starz|Showtime|ABC|CBS|NBC|Fox",
            name,
        ):
            continue
        add(tvg)

    for tvg in FAST_PICKS:
        add(tvg)

    out_rows = []
    for i, tvg in enumerate(order, 1):
        row = selected[tvg]
        out_rows.append(
            {
                "position": i,
                "name": row["name"],
                "category": assign_category(row),
                "tvg_id": tvg,
                "enabled": row.get("enabled", "1"),
                "url": row["url"],
            }
        )

    with OUTPUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["position", "name", "category", "tvg_id", "enabled", "url"])
        writer.writeheader()
        writer.writerows(out_rows)

    counts = Counter(r["category"] for r in out_rows)
    print(f"TOTAL: {len(out_rows)} channels -> {OUTPUT}")
    for cat, count in counts.most_common():
        print(f"  {count:3} {cat}")


if __name__ == "__main__":
    main()
