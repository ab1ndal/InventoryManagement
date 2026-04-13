---
type: community
cohesion: 0.50
members: 4
---

# QZ Tray & Core Tables

**Cohesion:** 0.50 - moderately connected
**Members:** 4 nodes

## Members
- [[DB Table bills]] - document - CLAUDE.md
- [[DB Table customers]] - document - CLAUDE.md
- [[DB Table discounts]] - document - CLAUDE.md
- [[QZ Tray (LabelInvoice Printing)]] - document - CLAUDE.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/QZ_Tray_&_Core_Tables
SORT file.name ASC
```
