# Bağlam

**AI ajanları arasında ortak, insan onaylı proje hafızası.**

Aynı projede Claude Code, Cursor, Codex veya kendi ajanlarını kullanıyorsan, bir ajanın
öğrendiği karar diğerine geçmez. Bağlam bu boşluğu kapatır:

1. Bir ajan önemli bir şey öğrenir → `context_propose` ile **önerir**.
2. Sen terminalde `baglam pending` ile görürsün → `baglam approve` ile **onaylarsın**.
3. Diğer tüm ajanlar bir sonraki görevde `context_brief` ile bunu **görür**.

Ajanlar asla onaylayamaz. Bir ajanın zararlı bir web sayfasından "öğrendiği" bir şey,
sen onaylamadan diğer ajanlara ulaşamaz.

## Özellikler

- **5 kayıt türü:** `decision`, `convention`, `preference`, `fact`, `warning`
- **Kaynak bilgisi:** hangi ajan önerdi, gerekçesi ne, kim ne zaman onayladı
- **Seçici paylaşım:** kaydı sadece belirli ajanlara göster (`audience` / `--to`)
- **Süreli kayıt:** `ttl_days` / `--ttl` dolunca otomatik kaybolur
- **Yerine geçme:** yeni karar eskisini `supersedes` ile emekliye ayırır, geçmiş korunur
- **Tam metin arama** (SQLite FTS5)
- **Proje izolasyonu:** her git kökü ayrı bir proje
- **Yerel ve bağımlılıksız:** tek SQLite dosyası (`~/.baglam/baglam.db`); native derleme yok, bulut yok

## Kurulum

Gereken: Node.js ≥ 22.13

```bash
cd C:/Users/ev/Desktop/BAĞLAM
npm install
npm run build
npm link
```

`npm link` sonrası `baglam` komutu her terminalde çalışır.

## Ajanlara bağlama

### Claude Code

```bash
claude mcp add baglam -s user -e BAGLAM_AGENT=claude-code -- node "C:/Users/ev/Desktop/BAĞLAM/dist/mcp.js"
```

Claude Code sunucuyu proje klasöründe başlattığı için proje otomatik algılanır.

### Cursor

Proje kökünde `.cursor/mcp.json` (veya global için `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "baglam": {
      "command": "node",
      "args": ["C:/Users/ev/Desktop/BAĞLAM/dist/mcp.js"],
      "env": { "BAGLAM_AGENT": "cursor", "BAGLAM_PROJECT": "${workspaceFolder}" }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.baglam]
command = "node"
args = ["C:/Users/ev/Desktop/BAĞLAM/dist/mcp.js"]
env = { BAGLAM_AGENT = "codex" }
```

### Ajanlara ne zaman kullanacaklarını söyle

Projenin `CLAUDE.md` / `AGENTS.md` / Cursor Rules dosyasına şunu ekle:

```markdown
## Ortak bağlam (Bağlam)
- Her görevin başında `context_brief` çağır ve oradaki kararlara uy.
- Kalıcı bir karar verdiğinde, bir konvansiyon veya kullanıcı tercihi öğrendiğinde ya da
  bir tuzağa düştüğünde `context_propose` ile öner. Eski bir kaydı değiştiriyorsa `supersedes` kullan.
- Sır, şifre veya kişisel veri önerme.
```

## Günlük kullanım

```bash
baglam pending                       # ajanların önerilerini gör
baglam approve c7k2m9xqa c3hp8rtwe   # seçerek onayla
baglam approve --all                 # hepsini onayla
baglam reject c7k2m9xqa --note "npm kullanıyoruz"
baglam list                          # aktif kayıtlar
baglam show c7k2m9xqa                # tek kayıt, tüm detay
baglam projects                      # tüm projeler ve sayılar

# Kendin doğrudan ekle (onaylı olarak girer):
baglam add warning "Prod DB salt okunur" "Ajanlar migration çalıştırmasın." --ttl 30
baglam add preference "Arayüz dili Türkçe" "Tüm UI metinleri Türkçe." --to cursor,claude-code
baglam add decision "MySQL'e geçildi" "Ana DB MySQL 8." --replaces c7k2m9xqa
```

Komutlar bulunduğun klasörün git kökünü proje olarak alır. Başka bir projede işlem
yapmak için `--project <yol>` ekle.

## MCP araçları

| Araç | Ne yapar |
|---|---|
| `context_brief` | Bu ajana açık, onaylı ve süresi dolmamış tüm kayıtlar (türe göre gruplu) ve bekleyen öneri sayısı |
| `context_search` | Görünür kayıtlarda tam metin arama (`query`, isteğe bağlı `kind`, `limit`) |
| `context_get` | Tek kayıt; neyin yerine geçtiği / neyle değiştirildiği dahil |
| `context_propose` | Yeni kayıt önerir (`kind`, `title`, `body`, `rationale`, `tags`, `audience`, `ttl_days`, `supersedes`) |

## Ortam değişkenleri

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `BAGLAM_DB` | `~/.baglam/baglam.db` | Veritabanı dosyası |
| `BAGLAM_PROJECT` | çalışma klasörünün git kökü | Proje anahtarı |
| `BAGLAM_AGENT` | MCP istemcisinin adı | Ajan adı (öneri kaynağı ve `audience` eşleşmesi) |
| `BAGLAM_USER` | `human:<kullanıcı adı>` | CLI onaylarında görünen ad |

## Geliştirme

```bash
npm test          # 27 test: veri katmanı, MCP sunucusu, CLI
npm run typecheck
npm run build
```

Tasarım ve kapsam dışı bırakılanlar: [docs/design.md](docs/design.md)
