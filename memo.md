# **Amazon Order Tracking Automation System / Система автоматизации отслеживания заказов Amazon**

This document outlines the architecture, workflow, and logic of the end-to-end automation system designed to synchronize Amazon order details, tracking statuses, and inventory data into a master Google Sheet.  
Этот документ описывает архитектуру, рабочий процесс и логику комплексной системы автоматизации, предназначенной для синхронизации деталей заказов Amazon, статусов отслеживания и данных об инвентаре в главной таблице Google Sheet.

## **1\. System Overview / Обзор системы**

The solution consists of two primary components operating in tandem:  
Решение состоит из двух основных компонентов, работающих в тандеме:

> * **Chrome Browser Extension:** Scrapes data directly from the user's Amazon account and triggers updates based on specific schedules or manual inputs.  
>   **Расширение для браузера Chrome:** Собирает данные напрямую из аккаунта Amazon пользователя и запускает обновления по расписанию или вручную.  
> * **Google Apps Script (Web App & Internal Scripts):** Receives JSON payloads from the extension, processes complex row-matching logic, handles self-healing URLs, and maintains the master table.  
>   **Google Apps Script (Web App и внутренние скрипты):** Получает JSON-данные от расширения, обрабатывает сложную логику сопоставления строк, восстанавливает битые ссылки и ведет главную таблицу.

## **2\. Primary Business Goals / Основные бизнес-цели**

> 1. **Fast Tracking Extraction:** Retrieve tracking numbers from Amazon as soon as they are generated and immediately flag them (via "Attention Required") for downstream processing.  
>    **Быстрое извлечение трек-номеров:** Получать трек-номера с Amazon сразу после их генерации и немедленно помечать их (через "Attention Required") для дальнейшей обработки.  
> 2. **Stale Shipment Monitoring:** Identify and monitor orders stuck in "Shipped" status for unusually long periods to ensure they eventually reach "Delivered" or are flagged for manual review.  
>    **Мониторинг зависших отправлений:** Выявлять и отслеживать заказы, зависшие в статусе "Shipped" на необычно долгий срок, чтобы убедиться, что они в итоге перейдут в "Delivered" или будут отмечены для ручной проверки.

## **3\. Chrome Extension Actions / Действия расширения Chrome**

The extension has three core automated actions built-in / В расширение вшиты три основных автоматизированных действия:

| Action Name / Название действия | Trigger & Frequency / Триггер и частота | Description / Описание   |
| :---- | :---- | :---- |
| **1\. Get New Orders** | Manual or Timer-based *Вручную или по таймеру* | Opens recent order pages (default: last 10 pages). Parses new orders and sends them sequentially to the Web App. The Google Script checks for existing orders; if an order exists, it is ignored. If new, it creates new rows. Открывает последние страницы заказов (по умолчанию: 10 страниц). Парсит новые заказы и последовательно отправляет их в Web App. Скрипт проверяет наличие заказа: существующие игнорируются, для новых создаются новые строки. |
| **2\. Update Tracking Pages** | Hourly (approx. 100 pages/run) *Ежечасно (около 100 стр/запуск)* | Targets rows where status is **Empty** or **"Ordered"**. Scrapes the Tracking Page and sends payloads to the Web App. Updates statuses to "Shipped" or "Out for Delivery", inserts tracking numbers, and checks "Attention Required". Executes the Split Package logic (see below). Работает по строкам, где статус **Пустой** или **"Ordered"**. Парсит Tracking Page и отправляет данные в Web App. Обновляет статус на "Shipped" и др., вставляет трек-номер и ставит галку "Attention Required". Выполняет логику разделения посылок (см. ниже). |
| **3\. Finalize Deliveries** | Daily or Bi-weekly *Ежедневно или 2 раза в неделю* | Targets orders already marked as **"Shipped"** or **"Out for Delivery"**. Checks if the items successfully reached "Delivered" or hit a negative status (Canceled, Refunded, Replaced) to finalize the lifecycle or require manual review. Проверяет заказы со статусами **"Shipped"** или **"Out for Delivery"**. Цель — превратить их в "Delivered" или отловить негативные статусы (Отменен, Возвращен, Заменен) для завершения цикла или ручного вмешательства. |

## **4\. Master Google Script Logic / Логика главного Google Скрипта**

### **4.1. Split Package & Self-Healing Link Workflow (Разделение посылок и самовосстановление ссылок)**

When the system processes a Tracking Page, it dynamically matches items via **Order ID** and **ASIN** using a quota system (to handle identical items in one order). If the script detects that an item expected in a package is missing (Amazon split the shipment):  
Когда система обрабатывает страницу отслеживания, она динамически сопоставляет товары по **Order ID** и **ASIN**, используя систему квот. Если скрипт обнаруживает, что ожидаемый товар отсутствует в посылке (Amazon разделил отправление):

> 1. **Link Replacement (Замена ссылки):** The script clears the broken Tracking Page link in Column F and replaces it with the **Order Details link** from Column E. / Скрипт убирает неактуальную ссылку отслеживания из колонки F и заменяет её на **ссылку Order Details** из колонки E.  
> 2. **Status Reset (Сброс статуса):** The status is left empty so it is picked up by the next hourly run. / Статус остается пустым, чтобы попасть в следующую ежечасную проверку.  
> 3. **The Healing Loop (Цикл восстановления):**  
   * *Pass 1:* Reads Tracking Page \-\> Item missing \-\> Replaces URL with Order Details.  
   * *Pass 2:* Next run reads Order Details \-\> Finds the new assigned Tracking URL \-\> Updates Column F \-\> Leaves status empty.  
   * *Pass 3:* Next run reads the NEW Tracking Page \-\> Retrieves actual tracking number and shipping status.

### **4.2. Automatic New Item Insertion (Автоматическое добавление новых товаров)**

If the payload from the Order Details page contains an ASIN that does not exist in the Google Sheet for that specific order (e.g., due to an Amazon substitution or bundle split), the script automatically generates brand new rows for these items, appended to the bottom of the table, exactly mimicking the primary order creation formatting.  
Если данные со страницы деталей заказа содержат ASIN, которого нет в таблице для этого заказа (например, из\-за замены товара Amazon), скрипт автоматически генерирует новые строки для этих позиций. Они добавляются в конец таблицы, полностью копируя форматирование первоначального парсера.

### **4.3. Internal Status Finalizer Script (Внутренний скрипт-финализатор статусов)**

An independent script resides directly in the Google Sheet. It parses the text within the "Estimated Delivery" / Event columns. Based on specific keywords at the beginning of the string, it forces a hard status update in the main Status column:  
Независимый скрипт живет непосредственно в файле Google Sheets. Он анализирует текст в колонках событий (Estimated Delivery). На основе ключевых слов в начале строки он принудительно проставляет итоговый статус в главной колонке:

> * Starts with **"Delivered"** → Sets status to Delivered  
> * Starts with **"Refunded"** → Sets status to Refunded  
> * Starts with **"Canceled"** → Sets status to Canceled

---

*Document Generated automatically for architecture reference / Документ сгенерирован автоматически как архитектурная справка.*