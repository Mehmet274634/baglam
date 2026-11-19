# Bağlam: Mac test listesi

Bu liste, Bağlam'ı bir Mac'te sıfırdan kurup denemek için. Yaklaşık **30–45 dakika** sürer. Bilgisayarcı
olmak gerekmez: her adımda ne yazacağın ve ne görmen gerektiği yazıyor.

**İhtiyacın olanlar**
- İnternete bağlı bir Mac
- **Claude Code** (giriş yapılmış)
- **Codex** veya **Cursor** (en az biri; ikisi de varsa daha iyi)

**Altın kural:** Bir şey beklenenden farklı görünürse durma, **ekran görüntüsü al** (⌘ Cmd + ⇧ Shift + 4,
sonra alanı seç) ve devam et. Ekran görüntülerinde şifre, token veya kod görünmesin.

---

## 1. Terminal'i aç
⌘ Cmd + Boşluk'a bas, `Terminal` yaz, Enter'a bas. Aşağıdaki komutları buraya yazıp her birinden sonra
Enter'a basacaksın.

## 2. Node.js sürümünü kontrol et
```
node -v
```
- **Beklenen:** `v22.13` veya daha yüksek bir sayı (ör. `v24.1.0`).
- "command not found" ya da daha düşük bir sayı çıkarsa: <https://nodejs.org> adresinden **LTS** sürümünü
  indirip kur, Terminal'i kapatıp yeniden aç ve bu adımı tekrarla.

## 3. Bağlam'ı kur
```
npm i -g baglam
```
- "EACCES" / "permission denied" hatası çıkarsa şunu yaz; Mac'in kendi şifreni ister (yazarken ekranda
  görünmez, normal):
  ```
  sudo npm i -g baglam
  ```
Sonra:
```
baglam --version
```
- **Beklenen:** `1.0.0-rc.3` 📸

## 4. Araçlara bağla
```
baglam setup
```
- Hangi araçları bulduğunu listeler ve onay ister: `y` yazıp Enter.
- **Beklenen:** Claude Code, Codex / Cursor satırlarının yanında ✓ işareti. 📸 (çıktının tamamı)

## 5. Deneme klasörü oluştur
Bu üç satırı tek tek yaz:
```
mkdir ~/baglam-test
cd ~/baglam-test
git init
```
- Mac "komut satırı geliştirici araçlarını yükle" diye sorarsa **Yükle**'ye bas, bitince `git init`'i
  tekrar yaz.

Sonra:
```
baglam init
```
- **Beklenen:** klasörün hazırlandığını söyleyen birkaç satır. 📸

## 6. Uygulamaları yeniden başlat
Claude Code, Codex ve Cursor açıksa **tamamen kapat** (⌘ Cmd + Q), sonra yeniden aç. Yeni ayarları
ancak böyle görürler.

## 7. Sağlık kontrolü
```
cd ~/baglam-test
baglam doctor
```
- **Beklenen:** çoğu satırda ✓. Codex için "hooks'a bir kez güven" gibi bir uyarı olabilir, normal
  (9. adımda yapacağız). 📸 (çıktının tamamı)

## 8. Claude Code ile bir işe başla
```
cd ~/baglam-test
claude
```
Claude Code açılınca şunu yaz:

> Tek bir HTML dosyası olarak basit bir yapılacaklar listesi uygulaması yaz. Şimdilik sadece ekleme
> özelliği olsun; silme özelliğini sonra yapacağız.

- Dosya izni sorarsa izin ver. İş bitince Claude Code'dan çık (`/exit` yaz veya Ctrl + C'ye iki kez bas).

Sonra Terminal'de:
```
baglam handoff
```
- **Beklenen:** yapılacaklar uygulamasıyla ilgili bir görev (başlığı senin isteğin veya Claude'un
  özeti olabilir) ve değişen dosya adı (ör. `index.html`). 📸

## 9. Başka bir ajanla devam et ("devir")

### 9a. Codex varsa
```
cd ~/baglam-test
codex
```
- Codex klasöre güvenip güvenmediğini sorarsa **evet** de.
- İlk seferde `/hooks` yaz ve Bağlam'ın kancalarına (hooks) **güven / trust** de. Bu, otomatik
  kaydetmenin Codex'te çalışması için bir kerelik gerekli.
- Sonra sadece şunu yaz:

> devam et

- **Beklenen:** Codex, yapılacaklar uygulamasından bahsetmeden bilmeli ve **silme özelliğini** eklemeye
  girişmeli. 📸 (Codex'in ilk cevabı)

### 9b. Cursor varsa (Mac için en önemli adım)
- Cursor'ı **Dock'tan veya Uygulamalar'dan** aç (Terminal'den değil).
- File → Open Folder → `baglam-test` klasörünü seç.
- Sohbet penceresine şunu yaz:

> devam et

- **Beklenen:** Cursor görevi bilmeli. 📸
- Cursor bir dosyayı değiştirdikten sonra Terminal'e dön:
  ```
  cd ~/baglam-test
  baglam doctor
  ```
- **Bak:** "Cursor: auto-save" satırında **"last automatic save …"** (en son ne zaman otomatik
  kaydettiği) yazıyor mu? Hâlâ "no automatic save yet" yazıyorsa bu çok değerli bir bulgu. 📸

## 10. Paneli aç
```
cd ~/baglam-test
baglam ui
```
- Tarayıcıda Bağlam paneli açılır. **Projects** bölümüne bak: `baglam-test` ve "Continue from here"
  kartı görünüyor mu? 📸
- İşin bitince Terminal'e dönüp Ctrl + C'ye bas.

## 11. Bir şey ters gittiyse
Bu komut otomatik kaydetmenin hata kaydını gösterir (dosya yoksa "No such file" der, bu da iyi haber):
```
cat ~/.baglam/hook-errors.log
```
📸

---

## Geri gönderilecekler
1. Bütün 📸 ekran görüntüleri (adım numarasıyla birlikte, ör. "adım 7").
2. Mac modeli ve macOS sürümü ( menüsü → Bu Mac Hakkında).
3. Hangi araçlar kullanıldı (Claude Code, Codex, Cursor) ve hangi adımda takılındı.
4. Kısaca: "devam et" deyince ikinci ajan işi gerçekten bildi mi?

## İsteğe bağlı: temizlik
Denemeden sonra her şeyi kaldırmak için:
```
baglam setup --undo
npm rm -g baglam
rm -rf ~/baglam-test
```
(`sudo` ile kurduysan ikinci satırı `sudo npm rm -g baglam` olarak yaz.)
