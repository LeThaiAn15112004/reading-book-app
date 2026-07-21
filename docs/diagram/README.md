# Diagrams (PlantUML)




## Mục lục

- [Cách export](#cách-export)
- [Danh sách](#danh-sách)
  - [SRS](#srs)
  - [SDS](#sds)

---

Mỗi diagram nằm trong **một folder con**: nguồn `.puml` và ảnh export (`.png`).

## Cách export

Yêu cầu: Java + `npx` (package `plantuml-cli`).

```bash
# Từ thư mục docs/diagram
npx --yes plantuml-cli "**/*.puml"
```

Hoặc từng folder:

```bash
npx --yes plantuml-cli "wf-02-import/wf-02.puml"
```

## Danh sách

### SRS


| Folder                   | File nguồn      | Ảnh export     | Dùng trong SRS                |
| ------------------------ | --------------- | -------------- | ----------------------------- |
| `context/`               | `context.puml`  | `context.png`  | §2.1 Context Diagram          |
| `use-case/`              | `use-case.puml` | `use-case.png` | §2.6 Use Case Diagram         |
| `overview-mvp/`          | `overview.puml` | `overview.png` | §2.7 Tổng quan Main Workflows |
| `wf-01-library/`         | `wf-01.puml`    | `wf-01.png`    | §2.7 WF-01 Library            |
| `wf-02-import/`          | `wf-02.puml`    | `wf-02.png`    | §2.7 WF-02 Import             |
| `wf-03-reading-session/` | `wf-03.puml`    | `wf-03.png`    | §2.7 WF-03 Phiên đọc          |
| `wf-04-knowledge/`       | `wf-04.puml`    | `wf-04.png`    | §2.7 WF-04 Nắm tri thức       |

### SDS


| Folder                        | File nguồn                         | Ảnh export                       | Dùng trong SDS              |
| ----------------------------- | ---------------------------------- | -------------------------------- | --------------------------- |
| `sds-layered/`                | `sds-layered.puml`                 | `sds-layered.png`                | §2.3 Layered Architecture   |
| `sds-architecture-overview/`  | `sds-architecture-overview.puml`   | `sds-architecture-overview.png`  | §2.4 Architecture Overview  |
| `sds-electron-process/`       | `sds-electron-process.puml`        | `sds-electron-process.png`       | §2.5 Electron Process       |
| `sds-ports-adapters/`         | `sds-ports-adapters.puml`          | `sds-ports-adapters.png`         | §2.6 Ports & Adapters       |
| `sds-monorepo/`               | `sds-monorepo.puml`                | `sds-monorepo.png`               | §2.7 Monorepo map           |
| `sds-erd/`                    | `sds-erd.puml`                     | `sds-erd.png`                    | §3.2 ERD                    |
| `sds-class/`                  | `sds-class.puml`                   | `sds-class.png`                  | §3.8 Class Diagram          |
| `sds-database/`               | `sds-database.puml`                | `sds-database.png`               | §3.9 Database Diagram       |
