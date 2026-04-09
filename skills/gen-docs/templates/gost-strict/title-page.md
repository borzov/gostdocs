---
title-meta: "{doc_type}"
---

<!-- GOST mode: strict | Template version: 1.0 -->
<!-- Reference: ГОСТ 19.104-78, ГОСТ 19.106-78, РД 50-34.698-90 -->

<!-- AGENT: This is the title page template for GOST-compliant documents.
It uses LaTeX formatting for PDF generation via Pandoc.

VARIABLE SUBSTITUTION:
Replace the following placeholders with actual values:
- {organization}    — full legal name of the organization (e.g., ООО «Рога и Копыта»)
- {system_name}     — full system name (e.g., Автоматизированная система управления складом «СкладПро»)
- {doc_type}        — document type in Russian, one of:
                      • Руководство пользователя
                      • Руководство администратора
                      • Руководство оператора
                      • Техническое описание
- {doc_code}        — document designation code per ГОСТ 19.103-77 (e.g., АБВГ.12345-01 34 01-1)
                      If no code assigned, use project identifier + document type abbreviation
- {version}         — document version (e.g., 1.0, 2.1)
- {city}            — city of publication (e.g., Москва)
- {year}            — year of publication (e.g., 2026)

SOURCE: spec-reader SYSTEM PURPOSE (for system_name), project metadata (for organization, city, year).

GENERATION RULES:
1. Title page MUST be generated for every document in the set
2. All text on the title page MUST be centered
3. Organization name appears at the top
4. System name is the largest/boldest text
5. Document type appears below the system name
6. Document code appears below the document type
7. Version appears below the code
8. City and year appear at the bottom
8. The page MUST end with \newpage to separate from document content
-->

\newpage

\begin{center}

\vspace*{3cm}

{\large {organization}}

\vspace{2cm}

{\Large\textbf{{system_name}}}

\vspace{1cm}

{\large {doc_type}}

\vspace{0.5cm}

{doc_code}

\vspace{1cm}

Версия {version}

\vfill

{city}, {year}

\end{center}

\newpage

<!-- AGENT: ADDITIONAL PAGES (generate if required by the document set):

APPROVAL PAGE (Лист утверждения) — if document requires formal approval:

\newpage

\begin{center}

\vspace*{2cm}

УТВЕРЖДАЮ

\vspace{0.5cm}

{approver_title}

\vspace{1cm}

\_\_\_\_\_\_\_\_\_\_\_\_\_\_ {approver_name}

\vspace{0.3cm}

«\_\_\_» \_\_\_\_\_\_\_\_\_\_\_\_ {year} г.

\end{center}

\vfill

\newpage


REVISION HISTORY (Лист регистрации изменений) — append at document end:

| № изменения | Номер листов (страниц) | Номер документа | Подпись | Дата |
|-------------|----------------------|-----------------|---------|------|
|             | изменённых \| заменённых \| новых \| аннулированных |  |  |  |

-->
