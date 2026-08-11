# ZwainDev Deprem API v4.0

Türkiye anlık deprem takip API + modern dashboard.

## Kurulum

```bash
npm install
npm start
```

Tarayıcı: http://localhost:3000

## Yenilikler (v4.0)

### Backend
- Kandilli parser güncellendi (güncel format)
- AFAD + Kandilli yedekli veri çekme
- Statik frontend servisi eklendi (`/` → dashboard)
- Sıralama: varsayılan zamana göre (en yeni üstte)
- Daha fazla şehir / zemin tipi
- Rate limit 500 istek / 15 dk
- Daha iyi hata yönetimi ve loglar

### Frontend
- **Leaflet harita** (karanlık tema, büyüklüğe göre renk/boyut)
- Filtreler seçimi koruyor
- Yer arama (text search)
- Otomatik yenileme countdown
- Daha temiz dark UI
- Responsive iyileştirmeler
- Kaynak badge (Kandilli / AFAD)

## API Örnekleri

- `GET /api/depremler?buyukluk=3&saat=24&limit=50`
- `GET /api/deprem/{id}`
- `GET /api/son-depremler`
- `GET /api/istatistikler`
- `GET /api/siddet-haritasi`
- `GET /api/bolgesel-risk`
- `GET /api/durum`

## Not

Veri kaynakları: Kandilli (öncelikli) + AFAD.
