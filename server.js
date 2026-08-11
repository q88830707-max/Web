const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & performance
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(compression());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'ZwainDev');
    res.setHeader('X-Developer', 'ZwainDev');
    res.setHeader('X-API-Version', '4.0.0');
    next();
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { success: false, error: 'Çok fazla istek. Lütfen 15 dakika sonra tekrar deneyin.' }
});
app.use('/api/', limiter);

// Static frontend
app.use(express.static(path.join(__dirname), {
    index: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

let depremCache = {
    depremler: [],
    lastUpdate: null,
    toplam: 0,
    kaynak: null
};

let bolgeselRisk = {};

const zeminTipleri = {
    'İstanbul': { tip: 'Karma', aciklama: 'Avrupa yakası sağlam, Anadolu yakası dolgu zemin', risk: 'YÜKSEK', buyutme: 2.5 },
    'İzmir': { tip: 'Alüvyon', aciklama: 'Körfez çevresi yumuşak zemin, iç kesimler andezit', risk: 'YÜKSEK', buyutme: 2.8 },
    'Ankara': { tip: 'Kaya', aciklama: 'Genel olarak sağlam volkanik kaya zemin', risk: 'DÜŞÜK', buyutme: 1.2 },
    'Bursa': { tip: 'Alüvyon', aciklama: 'Ova kesimi yumuşak zemin, dağ etekleri sağlam', risk: 'ORTA', buyutme: 1.8 },
    'Antalya': { tip: 'Traverten', aciklama: 'Falez bölgesı traverten, iç kesimler alüvyon', risk: 'ORTA', buyutme: 1.5 },
    'Adana': { tip: 'Alüvyon', aciklama: 'Seyhan-Ceyhan deltası, yüksek su tablası', risk: 'YÜKSEK', buyutme: 2.3 },
    'Kocaeli': { tip: 'Alüvyon', aciklama: 'İzmit Körfezi dolgu alanı, kuzeyi kayalık', risk: 'YÜKSEK', buyutme: 2.6 },
    'Sakarya': { tip: 'Alüvyon', aciklama: 'Adapazarı ovası sıvılaşma riski yüksek', risk: 'ÇOK YÜKSEK', buyutme: 3.0 },
    'Hatay': { tip: 'Alüvyon', aciklama: 'Asi Nehri deltası, Amik Ovası yumuşak zemin', risk: 'ÇOK YÜKSEK', buyutme: 3.2 },
    'Kahramanmaraş': { tip: 'Karma', aciklama: 'Dağlık kesim sağlam, ova alüvyon', risk: 'YÜKSEK', buyutme: 2.4 },
    'Van': { tip: 'Alüvyon', aciklama: 'Van Gölü çevresi genç çökeller', risk: 'YÜKSEK', buyutme: 2.2 },
    'Erzincan': { tip: 'Alüvyon', aciklama: 'Ova tabanı kalın alüvyon, sıvılaşma riski', risk: 'ÇOK YÜKSEK', buyutme: 3.1 },
    'Denizli': { tip: 'Traverten', aciklama: 'Pamukkale travertenleri, deprem dalgasını sönümler', risk: 'DÜŞÜK', buyutme: 1.1 },
    'Muğla': { tip: 'Karma', aciklama: 'Kıyı şeridi alüvyon, iç kesimler mermer-kireçtaşı', risk: 'ORTA', buyutme: 1.6 },
    'Çanakkale': { tip: 'Karma', aciklama: 'Kıyı dolgu, iç kesimler volkanik kaya', risk: 'ORTA', buyutme: 1.7 },
    'Balıkesir': { tip: 'Karma', aciklama: 'Ova alüvyon, dağlık kesim granit', risk: 'ORTA', buyutme: 1.6 },
    'Manisa': { tip: 'Alüvyon', aciklama: 'Gediz Ovası yumuşak zemin, sıvılaşma riski', risk: 'YÜKSEK', buyutme: 2.7 },
    'Aydın': { tip: 'Alüvyon', aciklama: 'Büyük Menderes Ovası kalın alüvyon', risk: 'YÜKSEK', buyutme: 2.5 },
    'Bolu': { tip: 'Karma', aciklama: 'Dağlık kesim sağlam, ova alüvyon', risk: 'ORTA', buyutme: 1.8 },
    'Düzce': { tip: 'Alüvyon', aciklama: 'Düzce Ovası sıvılaşma riski çok yüksek', risk: 'ÇOK YÜKSEK', buyutme: 3.3 },
    'Malatya': { tip: 'Karma', aciklama: 'Dağlık ve ova karışık zemin', risk: 'YÜKSEK', buyutme: 2.3 },
    'Elazığ': { tip: 'Karma', aciklama: 'Doğu Anadolu Fay hattı güzergahı', risk: 'YÜKSEK', buyutme: 2.4 },
    'Bingöl': { tip: 'Alüvyon', aciklama: 'Ova kesimi yumuşak zemin', risk: 'YÜKSEK', buyutme: 2.5 },
    'Osmaniye': { tip: 'Alüvyon', aciklama: 'Ceyhan ovası alüvyon', risk: 'YÜKSEK', buyutme: 2.4 },
    'Gaziantep': { tip: 'Karma', aciklama: 'Kısmen alüvyon, kısmen kireçtaşı', risk: 'YÜKSEK', buyutme: 2.2 },
    'Yalova': { tip: 'Alüvyon', aciklama: 'Kıyı dolgu alanları', risk: 'YÜKSEK', buyutme: 2.6 },
    'Tekirdağ': { tip: 'Karma', aciklama: 'Marmara kıyısı riskli zemin', risk: 'YÜKSEK', buyutme: 2.3 }
};

function buyuklukDetay(buyukluk) {
    const siniflandirma = {
        ultraMikro: { sinif: 'Ultra Mikro', renk: '#bdc3c7', hasar: 'Yok', etki: 'Sadece sismograflar kaydeder', enerji: '1-10 Joule', karsilastirma: 'Merdiven çıkmak' },
        mikro: { sinif: 'Mikro', renk: '#95a5a6', hasar: 'Yok', etki: 'Çok hassas kişiler hisseder', enerji: '10-1000 Joule', karsilastirma: 'Hafif rüzgar' },
        cokHafif: { sinif: 'Çok Hafif', renk: '#3498db', hasar: 'Yok', etki: 'Bina içindekiler hisseder', enerji: '1-10 MJ', karsilastirma: 'Küçük araba çarpması' },
        hafif: { sinif: 'Hafif', renk: '#2ecc71', hasar: 'Çok Az', etki: 'Eşyalar sallanır, herkes hisseder', enerji: '10-100 MJ', karsilastirma: '1 ton TNT' },
        orta: { sinif: 'Orta', renk: '#f1c40f', hasar: 'Hafif', etki: 'Bacalar devrilebilir, sıvalar dökülebilir', enerji: '100-1000 MJ', karsilastirma: '10 ton TNT' },
        guclu: { sinif: 'Güçlü', renk: '#e67e22', hasar: 'Orta', etki: 'Zayıf binalar hasar görür', enerji: '1-10 GJ', karsilastirma: '100 ton TNT' },
        cokGuclu: { sinif: 'Çok Güçlü', renk: '#d35400', hasar: 'Ağır', etki: 'Binalarda çatlaklar, köprülerde hasar', enerji: '10-100 GJ', karsilastirma: '1000 ton TNT' },
        buyuk: { sinif: 'Büyük', renk: '#e74c3c', hasar: 'Çok Ağır', etki: 'Binalar çöker, yer yarılır', enerji: '100-1000 GJ', karsilastirma: 'Hiroşima atom bombası' },
        cokBuyuk: { sinif: 'Çok Büyük', renk: '#c0392b', hasar: 'Yıkıcı', etki: 'Geniş alanda yıkım', enerji: '1-10 PJ', karsilastirma: '100 Hiroşima bombası' },
        dev: { sinif: 'Dev', renk: '#922b21', hasar: 'Felaket', etki: 'Topografya değişir, tsunami oluşur', enerji: '10+ PJ', karsilastirma: 'Tüm Dünya nükleer silahları' }
    };
    if (buyukluk >= 9) return siniflandirma.dev;
    if (buyukluk >= 8) return siniflandirma.cokBuyuk;
    if (buyukluk >= 7) return siniflandirma.buyuk;
    if (buyukluk >= 6) return siniflandirma.cokGuclu;
    if (buyukluk >= 5) return siniflandirma.guclu;
    if (buyukluk >= 4) return siniflandirma.orta;
    if (buyukluk >= 3) return siniflandirma.hafif;
    if (buyukluk >= 2) return siniflandirma.cokHafif;
    if (buyukluk >= 1) return siniflandirma.mikro;
    return siniflandirma.ultraMikro;
}

function enerjiHesapla(buyukluk) {
    const joule = Math.pow(10, (1.5 * buyukluk) + 4.8);
    if (joule >= 1e15) return { deger: (joule / 1e15).toFixed(2) + ' PJ', joule };
    if (joule >= 1e12) return { deger: (joule / 1e12).toFixed(2) + ' TJ', joule };
    if (joule >= 1e9) return { deger: (joule / 1e9).toFixed(2) + ' GJ', joule };
    if (joule >= 1e6) return { deger: (joule / 1e6).toFixed(2) + ' MJ', joule };
    if (joule >= 1e3) return { deger: (joule / 1e3).toFixed(2) + ' KJ', joule };
    return { deger: joule.toFixed(2) + ' J', joule };
}

function tntEsdeger(buyukluk) {
    const joule = Math.pow(10, (1.5 * buyukluk) + 4.8);
    const tonTNT = joule / 4.184e9;
    if (tonTNT >= 1e6) return (tonTNT / 1e6).toFixed(2) + ' Megaton TNT';
    if (tonTNT >= 1e3) return (tonTNT / 1e3).toFixed(2) + ' Kiloton TNT';
    return tonTNT.toFixed(2) + ' Ton TNT';
}

function atomBombasiEsdeger(buyukluk) {
    const joule = Math.pow(10, (1.5 * buyukluk) + 4.8);
    const hiroshima = joule / 6.3e13;
    if (hiroshima >= 1000) return (hiroshima / 1000).toFixed(1) + ' bin Hiroşima atom bombası';
    return hiroshima.toFixed(2) + ' Hiroşima atom bombası';
}

function dalgaTurleri() {
    return {
        pDalgalari: { isim: 'P Dalgaları (Primer)', hiz: '5-8 km/s', ozellik: 'En hızlı dalga, boyuna dalga', his: 'İlk gelen sarsıntı, dikey hareket', tespit: 'Sismograflar tarafından ilk kaydedilen dalga' },
        sDalgalari: { isim: 'S Dalgaları (Sekonder)', hiz: '3-5 km/s', ozellik: 'Enine dalga, sıvılardan geçemez', his: 'Asıl sarsıntı, yatay hareket', tespit: 'P dalgasından sonra gelen ikinci dalga' },
        loveDalgalari: { isim: 'Love Dalgaları', hiz: '2-4 km/s', ozellik: 'Yüzey dalgası, yatay hareket', his: 'Yer yüzeyinde yılan gibi kıvrılma', tespit: 'Binalarda en çok hasarı yapan dalga' },
        rayleighDalgalari: { isim: 'Rayleigh Dalgaları', hiz: '2-3 km/s', ozellik: 'Yüzey dalgası, eliptik hareket', his: 'Deniz tutması benzeri dalgalanma', tespit: 'Yer yüzeyinde yuvarlanma hareketi' }
    };
}

function sivilasmaRiski(zeminTipi, buyukluk, yeraltiSuyu = 5) {
    if (!zeminTipi || zeminTipi.tip === 'Kaya' || zeminTipi.tip === 'Traverten') {
        return { risk: 'DÜŞÜK', aciklama: 'Zemin yapısı sıvılaşmaya uygun değil' };
    }
    let riskPuani = 0;
    if (zeminTipi.tip === 'Alüvyon') riskPuani += 40;
    if (zeminTipi.tip === 'Karma') riskPuani += 20;
    if (buyukluk >= 6) riskPuani += 30;
    else if (buyukluk >= 5) riskPuani += 20;
    else if (buyukluk >= 4) riskPuani += 10;
    if (yeraltiSuyu <= 5) riskPuani += 20;
    if (riskPuani >= 70) return { risk: 'ÇOK YÜKSEK', aciklama: 'Acil önlem alınmalı, zemin iyileştirilmeli' };
    if (riskPuani >= 50) return { risk: 'YÜKSEK', aciklama: 'Sıvılaşma potansiyeli var, kontrol edilmeli' };
    if (riskPuani >= 30) return { risk: 'ORTA', aciklama: 'Belirli koşullarda sıvılaşma görülebilir' };
    return { risk: 'DÜŞÜK', aciklama: 'Sıvılaşma riski düşük' };
}

function artciTahmini(anaBuyukluk, gecenSureSaat) {
    const artciSayisi = Math.round(Math.pow(10, 0.8 * anaBuyukluk - 0.5));
    const enBuyukArtci = Math.max(0, anaBuyukluk - 1.2);
    const artciSuresi = Math.round(Math.pow(10, 0.5 * anaBuyukluk - 0.3)) * 24;
    let tahmin = 'İlk 24 saatte artçı depremler yoğun olacak';
    if (anaBuyukluk >= 7) tahmin = 'Aylarca sürecek artçı deprem serisi bekleniyor';
    else if (anaBuyukluk >= 6) tahmin = 'Haftalarca sürecek artçı depremler olacak';
    else if (anaBuyukluk >= 5) tahmin = 'Birkaç gün artçı depremler devam edebilir';
    return {
        beklenenToplamArtci: artciSayisi,
        enBuyukArtci: enBuyukArtci.toFixed(1),
        artciSuresi: Math.round(artciSuresi / 24) + ' gün',
        tahmin,
        uyari: 'Artçı depremler sırasında hasarlı binalara girilmemeli'
    };
}

function tsunamiRiski(buyukluk, derinlik, enlem, boylam) {
    if (buyukluk < 6.5) return { risk: 'YOK', aciklama: 'Tsunami riski yok' };
    if (derinlik > 30) return { risk: 'DÜŞÜK', aciklama: 'Derin deprem, tsunami olasılığı düşük' };
    if (buyukluk >= 7 && derinlik < 15) return { risk: 'YÜKSEK', aciklama: 'Kıyı bölgeleri için tsunami tehlikesi var', dalgaYuksekligi: '3-10 metre' };
    return { risk: 'ORTA', aciklama: 'Yerel tsunami oluşabilir', dalgaYuksekligi: '1-3 metre' };
}

function yerHareketiHesapla(buyukluk, derinlik, mesafe = 10) {
    const pga = Math.exp(0.5 * buyukluk - 0.01 * derinlik - 0.003 * mesafe) * 0.1;
    const pgv = pga * 10;
    let siddet;
    if (pga > 1.0) siddet = 'Çok Şiddetli - Yıkıcı';
    else if (pga > 0.5) siddet = 'Şiddetli - Hasar Yapıcı';
    else if (pga > 0.2) siddet = 'Kuvvetli - Hissedilir';
    else if (pga > 0.1) siddet = 'Orta - Hafif Hissedilir';
    else siddet = 'Zayıf - Az Hissedilir';
    return {
        pga: (pga * 100).toFixed(2) + ' gal',
        pgv: pgv.toFixed(2) + ' cm/s',
        siddet,
        aciklama: pga > 0.5 ? 'Yapısal hasar riski var' : 'Yapısal hasar beklenmiyor'
    };
}

function siddetHesapla(buyukluk, derinlik, mesafe = 0) {
    let siddet = (buyukluk * 1.5) - (derinlik * 0.1) - (mesafe * 0.01);
    if (siddet >= 10) return { seviye: 'X', aciklama: 'Yıkıcı', etki: 'Binalar yıkılır, yer yarılır, raylar eğrilir' };
    if (siddet >= 9) return { seviye: 'IX', aciklama: 'Çok Şiddetli', etki: 'Binalarda büyük hasar, yer çatlakları' };
    if (siddet >= 8) return { seviye: 'VIII', aciklama: 'Şiddetli', etki: 'Bacalar devrilir, kum fışkırması' };
    if (siddet >= 7) return { seviye: 'VII', aciklama: 'Çok Kuvvetli', etki: 'Ayakta durmak zor, bacalar çatlar' };
    if (siddet >= 6) return { seviye: 'VI', aciklama: 'Kuvvetli', etki: 'Herkes hisseder, eşyalar devrilir' };
    if (siddet >= 5) return { seviye: 'V', aciklama: 'Orta', etki: 'Uyuyanlar uyanır, sıvılar çalkalanır' };
    if (siddet >= 4) return { seviye: 'IV', aciklama: 'Hafif', etki: 'Tabaklar tıkırdar, pencereler titrer' };
    if (siddet >= 3) return { seviye: 'III', aciklama: 'Çok Hafif', etki: 'Titreşim hafif, az kişi hisseder' };
    if (siddet >= 2) return { seviye: 'II', aciklama: 'Hissedilmez', etki: 'Sadece üst katlarda hafif sallantı' };
    return { seviye: 'I', aciklama: 'Aletsel', etki: 'Sadece sismograflar kaydeder' };
}

function sehirBul(location) {
    if (!location) return null;
    const sehirler = {
        'adana': 'Adana', 'adıyaman': 'Adıyaman', 'afyon': 'Afyonkarahisar', 'ağrı': 'Ağrı',
        'amasya': 'Amasya', 'ankara': 'Ankara', 'antalya': 'Antalya', 'artvin': 'Artvin',
        'aydın': 'Aydın', 'balıkesir': 'Balıkesir', 'bilecik': 'Bilecik', 'bingöl': 'Bingöl',
        'bitlis': 'Bitlis', 'bolu': 'Bolu', 'burdur': 'Burdur', 'bursa': 'Bursa',
        'çanakkale': 'Çanakkale', 'çankırı': 'Çankırı', 'çorum': 'Çorum', 'denizli': 'Denizli',
        'diyarbakır': 'Diyarbakır', 'edirne': 'Edirne', 'elazığ': 'Elazığ', 'erzincan': 'Erzincan',
        'erzurum': 'Erzurum', 'eskişehir': 'Eskişehir', 'gaziantep': 'Gaziantep', 'giresun': 'Giresun',
        'gümüşhane': 'Gümüşhane', 'hakkari': 'Hakkari', 'hatay': 'Hatay', 'ısparta': 'Isparta',
        'mersin': 'Mersin', 'istanbul': 'İstanbul', 'izmir': 'İzmir', 'kars': 'Kars',
        'kastamonu': 'Kastamonu', 'kayseri': 'Kayseri', 'kırklareli': 'Kırklareli', 'kırşehir': 'Kırşehir',
        'kocaeli': 'Kocaeli', 'konya': 'Konya', 'kütahya': 'Kütahya', 'malatya': 'Malatya',
        'manisa': 'Manisa', 'kahramanmaraş': 'Kahramanmaraş', 'maraş': 'Kahramanmaraş', 'mardin': 'Mardin',
        'muğla': 'Muğla', 'muş': 'Muş', 'nevşehir': 'Nevşehir', 'niğde': 'Niğde',
        'ordu': 'Ordu', 'rize': 'Rize', 'sakarya': 'Sakarya', 'samsun': 'Samsun',
        'siirt': 'Siirt', 'sinop': 'Sinop', 'sivas': 'Sivas', 'tekirdağ': 'Tekirdağ',
        'tokat': 'Tokat', 'trabzon': 'Trabzon', 'tunceli': 'Tunceli', 'şanlıurfa': 'Şanlıurfa',
        'urfa': 'Şanlıurfa', 'uşak': 'Uşak', 'van': 'Van', 'yozgat': 'Yozgat',
        'zonguldak': 'Zonguldak', 'aksaray': 'Aksaray', 'bayburt': 'Bayburt', 'karaman': 'Karaman',
        'kırıkkale': 'Kırıkkale', 'batman': 'Batman', 'şırnak': 'Şırnak', 'bartın': 'Bartın',
        'ardahan': 'Ardahan', 'ığdır': 'Iğdır', 'yalova': 'Yalova', 'karabük': 'Karabük',
        'kilis': 'Kilis', 'osmaniye': 'Osmaniye', 'düzce': 'Düzce',
        'mugla': 'Muğla', 'canakkale': 'Çanakkale', 'balikesir': 'Balıkesir',
        'kutahya': 'Kütahya', 'tekirdag': 'Tekirdağ', 'sanliurfa': 'Şanlıurfa',
        'kahramanmaras': 'Kahramanmaraş', 'elazig': 'Elazığ', 'bingol': 'Bingöl'
    };
    const locationLower = location.toLowerCase()
        .replace(/İ/g, 'i').replace(/I/g, 'ı')
        .replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü')
        .replace(/Ş/g, 'ş').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç');
    for (const [key, value] of Object.entries(sehirler)) {
        if (locationLower.includes(key)) return value;
    }
    return null;
}

function fayHattiBul(sehir) {
    if (!sehir) return null;
    const fayHatlari = {
        'Kuzey Anadolu Fay Hattı': {
            bolgeler: ['Çanakkale', 'Balıkesir', 'Bursa', 'Bilecik', 'Sakarya', 'Düzce', 'Bolu', 'Karabük', 'Çankırı', 'Kastamonu', 'Samsun', 'Tokat', 'Amasya', 'Erzincan', 'Erzurum', 'Muş', 'Bingöl', 'Van'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '1200 km', maxBuyukluk: 7.9, kaymaHizi: '20-25 mm/yıl', sonBuyukDeprem: '1999 Gölcük 7.4'
        },
        'Doğu Anadolu Fay Hattı': {
            bolgeler: ['Hatay', 'Osmaniye', 'Gaziantep', 'Kahramanmaraş', 'Adıyaman', 'Malatya', 'Elazığ', 'Bingöl', 'Muş', 'Bitlis'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '580 km', maxBuyukluk: 7.8, kaymaHizi: '10-15 mm/yıl', sonBuyukDeprem: '2023 Kahramanmaraş 7.7'
        },
        'Batı Anadolu Fay Hattı': {
            bolgeler: ['İzmir', 'Manisa', 'Aydın', 'Denizli', 'Muğla', 'Balıkesir', 'Kütahya', 'Uşak', 'Afyonkarahisar'],
            riskSeviyesi: 'YÜKSEK', uzunluk: '400 km', maxBuyukluk: 7.0, kaymaHizi: '5-10 mm/yıl', sonBuyukDeprem: '2020 İzmir 6.9'
        },
        'Marmara Fay Hattı': {
            bolgeler: ['İstanbul', 'Kocaeli', 'Yalova', 'Bursa', 'Tekirdağ'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '200 km', maxBuyukluk: 7.4, kaymaHizi: '20-25 mm/yıl', sonBuyukDeprem: 'Bekleniyor (1766 sonrası)'
        }
    };
    for (const [isim, fay] of Object.entries(fayHatlari)) {
        if (fay.bolgeler.includes(sehir)) return { isim, ...fay };
    }
    return null;
}

function depremNesnesiOlustur(base) {
    const { buyukluk, derinlik, enlem, boylam, yer, sehir, tarih, saat, gun, id, ml, mw, md, mb, ms, ilce, mahalle, tip, cozumKalitesi, istasyonSayisi, rms, gap, revize } = base;
    const zemin = zeminTipleri[sehir] || { tip: 'Bilinmiyor', risk: 'ORTA', buyutme: 1.5, aciklama: 'Zemin bilgisi bulunamadı' };
    const siniflandirma = buyuklukDetay(buyukluk);
    const enerji = enerjiHesapla(buyukluk);
    const siddet = siddetHesapla(buyukluk, derinlik);
    const fayHatti = fayHattiBul(sehir);
    const sivilasma = sivilasmaRiski(zemin, buyukluk);
    const tsunami = tsunamiRiski(buyukluk, derinlik, enlem, boylam);
    const yerHareketi = yerHareketiHesapla(buyukluk, derinlik);

    return {
        id,
        tarih,
        saat,
        gun,
        enlem,
        boylam,
        derinlik,
        buyukluk,
        ml: ml || 0,
        mw: mw || 0,
        md: md || 0,
        mb: mb || 0,
        ms: ms || 0,
        yer: yer || 'Bilinmiyor',
        sehir,
        ilce: ilce || null,
        mahalle: mahalle || null,
        tip: tip || 'Deprem',
        siniflandirma,
        enerji,
        tntEsdeger: tntEsdeger(buyukluk),
        atomBombasiEsdeger: atomBombasiEsdeger(buyukluk),
        siddet,
        fayHatti: fayHatti ? fayHatti.isim : null,
        fayRiski: fayHatti ? fayHatti.riskSeviyesi : null,
        fayUzunluk: fayHatti ? fayHatti.uzunluk : null,
        fayMaxBuyukluk: fayHatti ? fayHatti.maxBuyukluk : null,
        fayKaymaHizi: fayHatti ? fayHatti.kaymaHizi : null,
        faySonBuyukDeprem: fayHatti ? fayHatti.sonBuyukDeprem : null,
        zeminTipi: zemin.tip,
        zeminAciklama: zemin.aciklama,
        zeminRiski: zemin.risk,
        zeminBuyutme: zemin.buyutme,
        sivilasmaRiski: sivilasma,
        tsunamiRiski: tsunami,
        yerHareketi,
        cozumKalitesi: cozumKalitesi || null,
        istasyonSayisi: istasyonSayisi || null,
        rms: rms || null,
        gap: gap || null,
        revize: revize || false,
        dalgaTurleri: dalgaTurleri()
    };
}

async function kandilliCek() {
    const depremler = [];
    try {
        const response = await axios.get('http://www.koeri.boun.edu.tr/scripts/lst0.asp', {
            timeout: 12000,
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZwainDev-DepremAPI/4.0)' }
        });
        const text = Buffer.from(response.data).toString('latin1');
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            // Format: 2026.08.11 00:48:48  39.4533   44.5042        5.8      -.-  1.9  -.-   LOCATION...
            const match = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+(.+)$/);
            if (!match) continue;

            const [, yil, ay, gun, saat, dakika, saniye, enlemStr, boylamStr, derinlikStr, mdStr, mlStr, mwStr, rest] = match;
            const buyukluk = parseFloat(mlStr) || parseFloat(mwStr) || parseFloat(mdStr) || 0;
            if (buyukluk <= 0 || isNaN(buyukluk)) continue;

            const enlem = parseFloat(enlemStr);
            const boylam = parseFloat(boylamStr);
            const derinlik = parseFloat(derinlikStr) || 0;
            const yer = rest.replace(/\s+(İlksel|REVIZE)\s*$/i, '').trim();
            const sehir = sehirBul(yer);
            const tarihISO = new Date(`${yil}-${ay}-${gun}T${saat}:${dakika}:${saniye}+03:00`).toISOString();

            depremler.push(depremNesnesiOlustur({
                id: `kandilli-${yil}${ay}${gun}${saat}${dakika}${saniye}-${Math.round(enlem * 1000)}`,
                tarih: tarihISO,
                saat: `${saat}:${dakika}:${saniye}`,
                gun: `${gun}.${ay}.${yil}`,
                enlem, boylam, derinlik, buyukluk, yer, sehir,
                ml: parseFloat(mlStr) || 0,
                mw: parseFloat(mwStr) || 0,
                md: parseFloat(mdStr) || 0,
                tip: 'Deprem'
            }));
        }
        console.log(`Kandilli: ${depremler.length} deprem çekildi`);
    } catch (err) {
        console.error('Kandilli hatası:', err.message);
    }
    return depremler;
}

async function afadCek() {
    const depremler = [];
    const endpoints = [
        'https://deprem.afad.gov.tr/apiv2/event/filter',
        'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter'
    ];

    for (const url of endpoints) {
        try {
            const start = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
            const end = new Date().toISOString();
            const response = await axios.post(url, {
                start, end,
                orderby: 'eventDate',
                desc: true,
                skip: 0,
                take: 200,
                eventType: null,
                magnitude: null
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; ZwainDev-DepremAPI/4.0)'
                },
                timeout: 10000
            });

            if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                for (const d of response.data) {
                    const buyukluk = parseFloat(d.magnitude) || 0;
                    if (buyukluk <= 0) continue;
                    const sehir = sehirBul(d.location);
                    depremler.push(depremNesnesiOlustur({
                        id: d.eventId || `afad-${d.eventDate}`,
                        tarih: d.eventDate,
                        saat: new Date(d.eventDate).toLocaleTimeString('tr-TR'),
                        gun: new Date(d.eventDate).toLocaleDateString('tr-TR'),
                        enlem: parseFloat(d.latitude),
                        boylam: parseFloat(d.longitude),
                        derinlik: parseFloat(d.depth) || 0,
                        buyukluk,
                        yer: d.location || 'Bilinmiyor',
                        sehir,
                        ilce: d.district || null,
                        mahalle: d.neighborhood || null,
                        ml: parseFloat(d.ml || 0),
                        mw: parseFloat(d.mw || 0),
                        md: parseFloat(d.md || 0),
                        mb: parseFloat(d.mb || 0),
                        ms: parseFloat(d.ms || 0),
                        tip: d.type || 'Deprem',
                        cozumKalitesi: d.solutionQuality || null,
                        istasyonSayisi: d.numberOfStations || null,
                        rms: d.rms || null,
                        gap: d.gap || null,
                        revize: d.revised || false
                    }));
                }
                console.log(`AFAD (${url}): ${depremler.length} deprem çekildi`);
                break;
            }
        } catch (err) {
            console.error(`AFAD (${url}) hatası:`, err.message);
        }
    }
    return depremler;
}

async function veriCek() {
    // Önce Kandilli (daha stabil), sonra AFAD
    let depremler = await kandilliCek();
    let kaynak = 'Kandilli';

    if (depremler.length < 5) {
        const afad = await afadCek();
        if (afad.length > depremler.length) {
            depremler = afad;
            kaynak = 'AFAD';
        }
    }

    // Tekrarları temizle (yakın zaman + konum)
    const unique = [];
    const seen = new Set();
    for (const d of depremler) {
        const key = `${d.tarih?.slice(0, 16)}-${d.enlem?.toFixed(2)}-${d.boylam?.toFixed(2)}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(d);
        }
    }

    return { depremler: unique, kaynak };
}

async function updateCache() {
    console.log('ZwainDev v4.0 - Veri güncellemesi...');
    try {
        const { depremler, kaynak } = await veriCek();
        if (depremler && depremler.length > 0) {
            // En yeni tarih en üstte
            depremler.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));

            bolgeselRisk = {};
            depremler.forEach(d => {
                if (d.sehir) {
                    if (!bolgeselRisk[d.sehir]) {
                        bolgeselRisk[d.sehir] = {
                            depremSayisi: 0,
                            ortalamaBuyukluk: 0,
                            maxBuyukluk: 0,
                            toplamBuyukluk: 0,
                            fayHatti: d.fayHatti,
                            fayRiski: d.fayRiski,
                            zeminRiski: d.zeminRiski
                        };
                    }
                    bolgeselRisk[d.sehir].depremSayisi++;
                    bolgeselRisk[d.sehir].toplamBuyukluk += d.buyukluk;
                    bolgeselRisk[d.sehir].maxBuyukluk = Math.max(bolgeselRisk[d.sehir].maxBuyukluk, d.buyukluk);
                    bolgeselRisk[d.sehir].ortalamaBuyukluk = bolgeselRisk[d.sehir].toplamBuyukluk / bolgeselRisk[d.sehir].depremSayisi;
                }
            });

            depremCache = {
                depremler,
                lastUpdate: new Date().toISOString(),
                toplam: depremler.length,
                kaynak
            };
            console.log(`Güncelleme tamam: ${depremler.length} deprem (${kaynak})`);
        } else {
            console.warn('Hiç deprem verisi alınamadı');
        }
    } catch (err) {
        console.error('Cache güncelleme hatası:', err.message);
    }
}

cron.schedule('*/2 * * * *', updateCache);
updateCache();

// ========== API Endpoints ==========

app.get('/api', (req, res) => {
    res.json({
        success: true,
        api: 'ZwainDev Ultra Gelişmiş Deprem API',
        version: '4.0.0',
        developer: 'ZwainDev',
        status: 'active',
        kaynak: depremCache.kaynak,
        lastUpdate: depremCache.lastUpdate,
        ozellikler: [
            'Anlık deprem verileri (Kandilli + AFAD)',
            'Deprem enerji hesaplaması (Joule, TNT, Atom Bombası eşdeğeri)',
            'Deprem dalga türleri (P, S, Love, Rayleigh)',
            'Mercalli şiddet skalası',
            'Fay hattı detayları',
            'Zemin tipi ve büyütme faktörü',
            'Sıvılaşma risk analizi',
            'Tsunami risk değerlendirmesi',
            'Yer hareketi (PGA/PGV) hesaplaması',
            'Artçı deprem tahmini',
            'Bölgesel risk analizi',
            'Harita destekli dashboard'
        ],
        endpoints: {
            tumDepremler: '/api/depremler',
            depremDetay: '/api/deprem/{id}',
            sonDepremler: '/api/son-depremler',
            buyukDepremler: '/api/buyuk-depremler',
            sehireGore: '/api/depremler/sehir/{sehir}',
            buyuklugeGore: '/api/depremler/buyukluk/{buyukluk}',
            istatistikler: '/api/istatistikler',
            fayHatlari: '/api/fay-hatlari',
            bolgeselRisk: '/api/bolgesel-risk',
            riskAnalizi: '/api/risk-analizi/{sehir}',
            yakinDepremler: '/api/yakin-depremler',
            siddetHaritasi: '/api/siddet-haritasi',
            zeminBilgisi: '/api/zemin/{sehir}',
            enerjiHesapla: '/api/enerji/{buyukluk}',
            artciTahmini: '/api/artci-tahmini/{buyukluk}',
            durum: '/api/durum'
        }
    });
});

app.get('/api/depremler', (req, res) => {
    const { buyukluk, sehir, derinlik, limit = 100, saat, sinif, fayHatti, zeminRiski, siralama = 'zaman' } = req.query;
    let depremler = [...depremCache.depremler];

    if (buyukluk) depremler = depremler.filter(d => d.buyukluk >= parseFloat(buyukluk));
    if (sehir) depremler = depremler.filter(d => d.sehir && d.sehir.toLowerCase() === sehir.toLowerCase());
    if (derinlik) depremler = depremler.filter(d => d.derinlik <= parseFloat(derinlik));
    if (sinif) depremler = depremler.filter(d => d.siniflandirma.sinif === sinif);
    if (fayHatti) depremler = depremler.filter(d => d.fayHatti && d.fayHatti.includes(fayHatti));
    if (zeminRiski) depremler = depremler.filter(d => d.zeminRiski === zeminRiski);
    if (saat) {
        const saatOnce = new Date(Date.now() - parseInt(saat) * 60 * 60 * 1000);
        depremler = depremler.filter(d => new Date(d.tarih) > saatOnce);
    }

    if (siralama === 'buyukluk') {
        depremler.sort((a, b) => b.buyukluk - a.buyukluk);
    } else {
        depremler.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    }

    depremler = depremler.slice(0, parseInt(limit));
    res.json({
        success: true,
        count: depremler.length,
        total: depremCache.toplam,
        lastUpdate: depremCache.lastUpdate,
        kaynak: depremCache.kaynak,
        data: depremler
    });
});

app.get('/api/deprem/:id', (req, res) => {
    const deprem = depremCache.depremler.find(d => d.id === req.params.id || String(d.id) === String(req.params.id));
    if (!deprem) return res.status(404).json({ success: false, error: 'Deprem bulunamadı' });

    const yakinDepremler = depremCache.depremler
        .filter(d => d.id !== deprem.id)
        .map(d => ({
            ...d,
            mesafe: Math.round(Math.sqrt(Math.pow(d.enlem - deprem.enlem, 2) + Math.pow(d.boylam - deprem.boylam, 2)) * 111 * 100) / 100
        }))
        .filter(d => d.mesafe <= 100)
        .sort((a, b) => a.mesafe - b.mesafe)
        .slice(0, 30);

    const artci = artciTahmini(deprem.buyukluk, 1);
    res.json({
        success: true,
        data: {
            ...deprem,
            artciTahmini: artci,
            yakinDepremler: { count: yakinDepremler.length, data: yakinDepremler }
        }
    });
});

app.get('/api/son-depremler', (req, res) => {
    const { limit = 20 } = req.query;
    const depremler = [...depremCache.depremler]
        .sort((a, b) => new Date(b.tarih) - new Date(a.tarih))
        .slice(0, parseInt(limit));
    res.json({ success: true, count: depremler.length, lastUpdate: depremCache.lastUpdate, data: depremler });
});

app.get('/api/buyuk-depremler', (req, res) => {
    const depremler = depremCache.depremler
        .filter(d => d.buyukluk >= 4)
        .sort((a, b) => b.buyukluk - a.buyukluk);
    res.json({ success: true, count: depremler.length, data: depremler });
});

app.get('/api/depremler/sehir/:sehir', (req, res) => {
    const { sehir } = req.params;
    const depremler = depremCache.depremler.filter(d => d.sehir && d.sehir.toLowerCase() === sehir.toLowerCase());
    const risk = bolgeselRisk[sehir] || null;
    res.json({ success: true, sehir, count: depremler.length, risk, data: depremler });
});

app.get('/api/depremler/buyukluk/:buyukluk', (req, res) => {
    const buyukluk = parseFloat(req.params.buyukluk);
    const depremler = depremCache.depremler
        .filter(d => d.buyukluk >= buyukluk)
        .sort((a, b) => b.buyukluk - a.buyukluk);
    res.json({ success: true, minBuyukluk: buyukluk, count: depremler.length, data: depremler });
});

app.get('/api/fay-hatlari', (req, res) => {
    const fayHatlari = {
        'Kuzey Anadolu Fay Hattı': {
            bolgeler: ['Çanakkale', 'Balıkesir', 'Bursa', 'Sakarya', 'Düzce', 'Bolu', 'Erzincan', 'Van'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '1200 km', maxBuyukluk: 7.9, kaymaHizi: '20-25 mm/yıl', sonBuyukDeprem: '1999 Gölcük 7.4'
        },
        'Doğu Anadolu Fay Hattı': {
            bolgeler: ['Hatay', 'Gaziantep', 'Kahramanmaraş', 'Malatya', 'Elazığ', 'Bingöl'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '580 km', maxBuyukluk: 7.8, kaymaHizi: '10-15 mm/yıl', sonBuyukDeprem: '2023 Kahramanmaraş 7.7'
        },
        'Batı Anadolu Fay Hattı': {
            bolgeler: ['İzmir', 'Manisa', 'Aydın', 'Denizli', 'Muğla'],
            riskSeviyesi: 'YÜKSEK', uzunluk: '400 km', maxBuyukluk: 7.0, kaymaHizi: '5-10 mm/yıl', sonBuyukDeprem: '2020 İzmir 6.9'
        },
        'Marmara Fay Hattı': {
            bolgeler: ['İstanbul', 'Kocaeli', 'Yalova', 'Tekirdağ'],
            riskSeviyesi: 'ÇOK YÜKSEK', uzunluk: '200 km', maxBuyukluk: 7.4, kaymaHizi: '20-25 mm/yıl', sonBuyukDeprem: 'Bekleniyor (1766)'
        }
    };
    res.json({ success: true, count: Object.keys(fayHatlari).length, data: fayHatlari });
});

app.get('/api/bolgesel-risk', (req, res) => {
    const riskler = Object.entries(bolgeselRisk)
        .map(([sehir, veri]) => ({
            sehir,
            ...veri,
            ortalamaBuyukluk: Math.round(veri.ortalamaBuyukluk * 100) / 100,
            riskPuani: Math.round((veri.depremSayisi * veri.ortalamaBuyukluk) * 10)
        }))
        .sort((a, b) => b.riskPuani - a.riskPuani);
    res.json({ success: true, count: riskler.length, data: riskler });
});

app.get('/api/risk-analizi/:sehir', (req, res) => {
    const { sehir } = req.params;
    const depremler = depremCache.depremler.filter(d => d.sehir && d.sehir.toLowerCase() === sehir.toLowerCase());
    const fayHatti = fayHattiBul(sehir);
    const bolgeRisk = bolgeselRisk[sehir];
    const zemin = zeminTipleri[sehir];
    let riskPuani = 0;
    if (fayHatti) {
        if (fayHatti.riskSeviyesi === 'ÇOK YÜKSEK') riskPuani += 40;
        else if (fayHatti.riskSeviyesi === 'YÜKSEK') riskPuani += 30;
    }
    if (bolgeRisk) {
        riskPuani += bolgeRisk.depremSayisi * 2;
        riskPuani += bolgeRisk.ortalamaBuyukluk * 5;
    }
    if (zemin && zemin.risk === 'ÇOK YÜKSEK') riskPuani += 30;
    else if (zemin && zemin.risk === 'YÜKSEK') riskPuani += 20;

    let riskSeviyesi = 'DÜŞÜK';
    if (riskPuani >= 70) riskSeviyesi = 'ÇOK YÜKSEK';
    else if (riskPuani >= 50) riskSeviyesi = 'YÜKSEK';
    else if (riskPuani >= 30) riskSeviyesi = 'ORTA';

    res.json({
        success: true,
        sehir,
        analiz: {
            riskSeviyesi,
            riskPuani: Math.round(riskPuani),
            fayHatti,
            zemin,
            son24SaatDeprem: bolgeRisk ? bolgeRisk.depremSayisi : 0,
            ortalamaBuyukluk: bolgeRisk ? Math.round(bolgeRisk.ortalamaBuyukluk * 100) / 100 : 0,
            maxBuyukluk: bolgeRisk ? bolgeRisk.maxBuyukluk : 0,
            depremler: depremler.slice(0, 20)
        }
    });
});

app.get('/api/yakin-depremler', (req, res) => {
    const { enlem, boylam, mesafe = 100, limit = 50 } = req.query;
    if (!enlem || !boylam) return res.status(400).json({ success: false, error: 'Enlem ve boylam gerekli' });
    const yakinDepremler = depremCache.depremler
        .map(d => ({
            ...d,
            mesafe: Math.round(Math.sqrt(Math.pow(d.enlem - parseFloat(enlem), 2) + Math.pow(d.boylam - parseFloat(boylam), 2)) * 111 * 100) / 100
        }))
        .filter(d => d.mesafe <= parseFloat(mesafe))
        .sort((a, b) => a.mesafe - b.mesafe)
        .slice(0, parseInt(limit));
    res.json({
        success: true,
        merkez: { enlem: parseFloat(enlem), boylam: parseFloat(boylam) },
        mesafe: parseFloat(mesafe),
        count: yakinDepremler.length,
        data: yakinDepremler
    });
});

app.get('/api/siddet-haritasi', (req, res) => {
    const haritaVerisi = depremCache.depremler.map(d => ({
        id: d.id,
        enlem: d.enlem,
        boylam: d.boylam,
        buyukluk: d.buyukluk,
        derinlik: d.derinlik,
        siddet: d.siddet,
        sehir: d.sehir,
        yer: d.yer,
        tarih: d.tarih,
        saat: d.saat,
        renk: d.siniflandirma.renk,
        yerHareketi: d.yerHareketi
    }));
    res.json({ success: true, count: haritaVerisi.length, lastUpdate: depremCache.lastUpdate, data: haritaVerisi });
});

app.get('/api/zemin/:sehir', (req, res) => {
    const { sehir } = req.params;
    const zemin = zeminTipleri[sehir];
    if (!zemin) return res.status(404).json({ success: false, error: 'Şehir bulunamadı' });
    res.json({ success: true, sehir, zemin });
});

app.get('/api/enerji/:buyukluk', (req, res) => {
    const buyukluk = parseFloat(req.params.buyukluk);
    if (isNaN(buyukluk) || buyukluk < 0 || buyukluk > 10) {
        return res.status(400).json({ success: false, error: 'Büyüklük 0-10 arası olmalı' });
    }
    res.json({
        success: true,
        buyukluk,
        enerji: enerjiHesapla(buyukluk),
        tntEsdeger: tntEsdeger(buyukluk),
        atomBombasiEsdeger: atomBombasiEsdeger(buyukluk)
    });
});

app.get('/api/artci-tahmini/:buyukluk', (req, res) => {
    const buyukluk = parseFloat(req.params.buyukluk);
    const saat = parseFloat(req.query.saat) || 1;
    if (isNaN(buyukluk) || buyukluk < 3 || buyukluk > 10) {
        return res.status(400).json({ success: false, error: 'Büyüklük 3-10 arası olmalı' });
    }
    res.json({ success: true, buyukluk, artciTahmini: artciTahmini(buyukluk, saat) });
});

app.get('/api/istatistikler', (req, res) => {
    const depremler = depremCache.depremler;
    if (!depremler.length) return res.json({ success: true, message: 'Veri yok' });

    const buyuklukler = depremler.map(d => d.buyukluk).filter(b => b);
    const derinlikler = depremler.map(d => d.derinlik).filter(d => d);
    const dagilim = {
        'Ultra Mikro (<1)': depremler.filter(d => d.buyukluk < 1).length,
        'Mikro (1-2)': depremler.filter(d => d.buyukluk >= 1 && d.buyukluk < 2).length,
        'Çok Hafif (2-3)': depremler.filter(d => d.buyukluk >= 2 && d.buyukluk < 3).length,
        'Hafif (3-4)': depremler.filter(d => d.buyukluk >= 3 && d.buyukluk < 4).length,
        'Orta (4-5)': depremler.filter(d => d.buyukluk >= 4 && d.buyukluk < 5).length,
        'Güçlü (5-6)': depremler.filter(d => d.buyukluk >= 5 && d.buyukluk < 6).length,
        'Çok Güçlü (6-7)': depremler.filter(d => d.buyukluk >= 6 && d.buyukluk < 7).length,
        'Büyük (7+)': depremler.filter(d => d.buyukluk >= 7).length
    };
    const zeminDagilimi = {};
    depremler.forEach(d => {
        if (d.zeminRiski) zeminDagilimi[d.zeminRiski] = (zeminDagilimi[d.zeminRiski] || 0) + 1;
    });

    res.json({
        success: true,
        lastUpdate: depremCache.lastUpdate,
        kaynak: depremCache.kaynak,
        istatistikler: {
            toplam: depremler.length,
            ortalamaBuyukluk: (buyuklukler.reduce((a, b) => a + b, 0) / buyuklukler.length).toFixed(2),
            maxBuyukluk: Math.max(...buyuklukler),
            ortalamaDerinlik: (derinlikler.reduce((a, b) => a + b, 0) / derinlikler.length).toFixed(2) + ' km',
            enDerin: Math.max(...derinlikler).toFixed(1) + ' km',
            enSig: Math.min(...derinlikler).toFixed(1) + ' km',
            buyuklukDagilimi: dagilim,
            zeminRiskiDagilimi: zeminDagilimi
        }
    });
});

app.get('/api/durum', (req, res) => {
    const sonDeprem = depremCache.depremler[0];
    res.json({
        success: true,
        status: depremCache.depremler.length > 0 ? 'active' : 'error',
        lastUpdate: depremCache.lastUpdate,
        kaynak: depremCache.kaynak,
        depremSayisi: depremCache.toplam,
        buyukDepremSayisi: depremCache.depremler.filter(d => d.buyukluk >= 4).length,
        sonDeprem: sonDeprem ? {
            buyukluk: sonDeprem.buyukluk,
            yer: sonDeprem.yer,
            tarih: sonDeprem.tarih,
            enerji: sonDeprem.enerji.deger
        } : null
    });
});

// Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint bulunamadı' });
});

app.listen(PORT, () => {
    console.log(`ZwainDev Ultra Deprem API v4.0 → http://localhost:${PORT}`);
    console.log(`Dashboard → http://localhost:${PORT}/`);
});
