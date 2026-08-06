#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
nmr_dataset_app.py

Full rewrite of the NMR assignment / CSI / fitting / PDB dataset application.

Requested features implemented:
- Parameter Layer section is placed after the assignment table.
- Filter peaks button synchronized with Focus button in 3D view.
- Focus/filter hides table panels that contain no data for the selected residue.
- CSI plot customizable: font size, colors, horizontal lines, axis titles, x/y ratio, zoom.
- Secondary structure painting with optional forced consistency between painted SS and deviations.
- Fit results shown as error-bar graph with customizable graphics.
- PDB text is saved inside dataset JSON and restored on load.
- Sparky peak-list / assignment import for chemical shifts, intensities, and integrals per condition.
"""

import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple

from PySide6.QtCore import (
    Qt,
    Signal,
    QAbstractTableModel,
    QModelIndex,
    QSortFilterProxyModel,
)
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGridLayout,
    QFormLayout,
    QSplitter,
    QTabWidget,
    QGroupBox,
    QTableView,
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QPushButton,
    QToolButton,
    QLabel,
    QLineEdit,
    QSpinBox,
    QDoubleSpinBox,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QMessageBox,
    QColorDialog,
    QDialog,
    QDialogButtonBox,
    QAbstractItemView,
)

import numpy as np

from matplotlib.figure import Figure
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavigationToolbar

try:
    from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
except Exception:
    pass


# ---------------------------------------------------------------------
# Constants and utilities
# ---------------------------------------------------------------------

SECONDARY_STRUCTURES = ["coil", "alpha", "beta"]

SS_COLORS = {
    "coil": "#999999",
    "alpha": "#2ca02c",
    "beta": "#d62728",
}

RANDOM_COIL_SHIFTS = {
    "H": 8.20,
    "N": 118.0,
    "CA": 56.0,
    "CB": 28.0,
    "C": 176.0,
    "HA": 4.30,
}

EXPECTED_SS_DEVIATIONS = {
    "coil": {
        "H": 0.0,
        "N": 0.0,
        "CA": 0.0,
        "CB": 0.0,
        "C": 0.0,
        "HA": 0.0,
    },
    "alpha": {
        "H": 0.25,
        "N": 0.80,
        "CA": 2.40,
        "CB": -2.10,
        "C": 1.60,
        "HA": -0.20,
    },
    "beta": {
        "H": -0.20,
        "N": -0.60,
        "CA": -1.60,
        "CB": 1.70,
        "C": -1.10,
        "HA": 0.25,
    },
}

HEADER_KEYWORDS = {
    "assignment",
    "peak",
    "wh",
    "wn",
    "wc",
    "ca",
    "cb",
    "ha",
    "shift",
    "height",
    "volume",
    "integral",
    "intensity",
    "residue",
    "res",
    "atom",
    "type",
    "w1",
    "w2",
    "w3",
}

SHIFT_COLUMN_PATTERNS = [
    ("wh", "H"),
    ("wn", "N"),
    ("wc", "C"),
    ("ca", "CA"),
    ("cb", "CB"),
    ("ha", "HA"),
    ("halpha", "HA"),
    ("calpha", "CA"),
    ("shift", "SHIFT"),
]


def parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        try:
            return float(value)
        except Exception:
            return None
    s = str(value).strip().replace(",", "")
    if not s or s.lower() in {"none", "nan", "--", ""}:
        return None
    try:
        return float(s)
    except Exception:
        return None


def parse_int(value: Any) -> Optional[int]:
    f = parse_float(value)
    if f is None:
        return None
    return int(round(f))


def extract_residue_number(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        return int(value)
    s = str(value).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except Exception:
        pass
    m = re.search(r"(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def extract_residue_from_assignment_like(value: Any) -> Optional[int]:
    """Extract residue number only from text that looks like an assignment."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if not any(ch.isalpha() for ch in s):
        return None
    m = re.search(r"(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def normalize_atom(value: Any) -> str:
    if value is None:
        return ""
    a = str(value).strip().upper()
    a = re.sub(r"[^A-Z0-9]", "", a)
    if not a:
        return ""

    if a in {"HN", "H", "1H", "1HN", "H1"}:
        return "H"
    if a in {"N", "15N", "N15"}:
        return "N"
    if a in {"CA", "CALPHA"}:
        return "CA"
    if a in {"CB", "CBETA"}:
        return "CB"
    if a in {"HA", "HA1"}:
        return "HA"
    if a in {"C", "CO", "CARB"}:
        return "C"

    a_no_digits = re.sub(r"\d+", "", a)
    if a_no_digits in {"HN", "H"}:
        return "H"
    if a_no_digits in {"N"}:
        return "N"
    if a_no_digits in {"CA"}:
        return "CA"
    if a_no_digits in {"CB"}:
        return "CB"
    if a_no_digits in {"HA"}:
        return "HA"
    if a_no_digits in {"C"}:
        return "C"

    return a


def guess_atom_from_text(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""

    if "." in s:
        part = s.split(".")[-1]
        atom = normalize_atom(part)
        if atom:
            return atom

    m = re.search(r"[._\- ]([A-Za-z][A-Za-z0-9]*)$", s)
    if m:
        return normalize_atom(m.group(1))

    return normalize_atom(s)


def atom_from_header(name: Any) -> str:
    low = str(name).lower()
    if "wh" in low or low in {"h", "hn"}:
        return "H"
    if "wn" in low or low == "n":
        return "N"
    if "wc" in low or low == "c":
        return "C"
    if "ca" in low:
        return "CA"
    if "cb" in low:
        return "CB"
    if "ha" in low:
        return "HA"
    return normalize_atom(name)


def expected_deviation(atom: Any, ss: Any) -> float:
    atom = normalize_atom(atom)
    ss = str(ss or "coil").lower()
    if ss not in EXPECTED_SS_DEVIATIONS:
        ss = "coil"
    return float(EXPECTED_SS_DEVIATIONS.get(ss, {}).get(atom, 0.0))


def compute_deviation(
    shift: Any,
    atom: Any,
    ss: Any,
    force: bool = False,
) -> Optional[float]:
    atom_norm = normalize_atom(atom)
    ss_norm = str(ss or "coil").lower()

    if force:
        return expected_deviation(atom_norm, ss_norm)

    shift_f = parse_float(shift)
    rc = RANDOM_COIL_SHIFTS.get(atom_norm, None)
    if shift_f is None or rc is None:
        return None

    return shift_f - rc


def parse_hlines(text: Any) -> List[float]:
    values = []
    for part in str(text or "").split(","):
        v = parse_float(part.strip())
        if v is not None:
            values.append(v)
    return values


def options_from_dict(cls, d: Optional[Dict[str, Any]]):
    d = d or {}
    allowed = set(cls.__dataclass_fields__.keys())
    return cls(**{k: v for k, v in d.items() if k in allowed})


def sanitize_rows(
    rows: Optional[List[Dict[str, Any]]],
    keys: List[str],
    int_keys: Optional[set] = None,
    numeric_keys: Optional[set] = None,
) -> List[Dict[str, Any]]:
    int_keys = int_keys or set()
    numeric_keys = numeric_keys or set()
    out = []

    for row in rows or []:
        if not isinstance(row, dict):
            continue
        new = {k: row.get(k, None) for k in keys}
        for k in int_keys:
            new[k] = parse_int(new.get(k))
        for k in numeric_keys:
            if k not in int_keys:
                new[k] = parse_float(new.get(k))
        out.append(new)

    return out


# ---------------------------------------------------------------------
# PDB parsing
# ---------------------------------------------------------------------

@dataclass
class PdbAtom:
    atom_name: str
    res_name: str
    chain: str
    residue: int
    x: float
    y: float
    z: float


def parse_pdb_text(text: str) -> List[PdbAtom]:
    atoms = []

    for line in (text or "").splitlines():
        if not line.startswith(("ATOM", "HETATM")):
            continue
        try:
            atom_name = line[12:16].strip()
            res_name = line[17:20].strip()
            chain = line[21] if len(line) > 21 else ""
            residue = int(line[22:26])
            x = float(line[30:38])
            y = float(line[38:46])
            z = float(line[46:54])
            atoms.append(
                PdbAtom(
                    atom_name=atom_name,
                    res_name=res_name,
                    chain=chain,
                    residue=residue,
                    x=x,
                    y=y,
                    z=z,
                )
            )
        except Exception:
            continue

    ca_atoms = [a for a in atoms if a.atom_name.upper() == "CA"]
    return ca_atoms if ca_atoms else atoms


# ---------------------------------------------------------------------
# Sparky parsing
# ---------------------------------------------------------------------

def text_looks_like_header(parts: List[str]) -> bool:
    if not parts:
        return False

    low = " ".join(parts).lower()
    if any(k in low for k in HEADER_KEYWORDS):
        return True

    numeric_count = sum(1 for p in parts if parse_float(p) is not None)
    return numeric_count == 0 and len(parts) >= 2


def parse_sparky_table(text: str) -> Tuple[List[str], List[List[str]]]:
    lines = [
        line.rstrip()
        for line in (text or "").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    if not lines:
        return [], []

    first_parts = lines[0].split()

    if text_looks_like_header(first_parts):
        header = [str(x) for x in first_parts]
        data_lines = lines[1:]
    else:
        max_cols = max(len(line.split()) for line in lines)
        header = [f"col{i+1}" for i in range(max_cols)]
        data_lines = lines

    records = []
    for line in data_lines:
        parts = line.split()
        if not parts:
            continue

        if len(parts) < len(header):
            parts = parts + [""] * (len(header) - len(parts))
        elif len(parts) > len(header):
            parts = parts[: len(header)]

        records.append(parts)

    return header, records


def detect_shift_columns(header: List[str]) -> List[Tuple[int, str]]:
    out = []
    for i, h in enumerate(header or []):
        low = str(h).lower()
        for pattern, atom in SHIFT_COLUMN_PATTERNS:
            if pattern in low:
                out.append((i, atom))
                break
    return out


# ---------------------------------------------------------------------
# Option dataclasses
# ---------------------------------------------------------------------

@dataclass
class CSIOptions:
    font_size: int = 10
    positive_color: str = "#d62728"
    negative_color: str = "#1f77b4"
    hlines: str = "-0.5,0.5"
    x_title: str = "Residue"
    y_title: str = "Chemical shift index"
    x_y_ratio: float = 2.0
    show_grid: bool = True


@dataclass
class FitOptions:
    font_size: int = 10
    marker_color: str = "#1f77b4"
    error_color: str = "#555555"
    capsize: int = 4
    hlines: str = ""
    x_title: str = "Fitted parameter"
    y_title: str = "Optimized value"
    x_y_ratio: float = 1.5
    show_grid: bool = True


# ---------------------------------------------------------------------
# Table models
# ---------------------------------------------------------------------

class TableModelBase(QAbstractTableModel):
    KEYS: List[str] = []
    HEADERS: List[str] = []
    NUMERIC_KEYS: set = set()
    INT_KEYS: set = set()

    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None, parent=None):
        super().__init__(parent)
        self.rows: List[Dict[str, Any]] = rows if rows is not None else []

    def rowCount(self, parent: QModelIndex = QModelIndex()) -> int:
        if parent.isValid():
            return 0
        return len(self.rows)

    def columnCount(self, parent: QModelIndex = QModelIndex()) -> int:
        if parent.isValid():
            return 0
        return len(self.KEYS)

    def data(self, index: QModelIndex, role: int = Qt.DisplayRole):
        if not index.isValid():
            return None

        if role in (Qt.DisplayRole, Qt.EditRole):
            key = self.KEYS[index.column()]
            value = self.rows[index.row()].get(key, None)
            return "" if value is None else value

        return None

    def headerData(self, section: int, orientation: Qt.Orientation, role: int = Qt.DisplayRole):
        if orientation == Qt.Horizontal and role == Qt.DisplayRole:
            if 0 <= section < len(self.HEADERS):
                return self.HEADERS[section]
        return None

    def flags(self, index: QModelIndex) -> Qt.ItemFlags:
        if not index.isValid():
            return Qt.NoItemFlags
        return Qt.ItemIsEnabled | Qt.ItemIsSelectable | Qt.ItemIsEditable

    def setData(self, index: QModelIndex, value: Any, role: int = Qt.EditRole) -> bool:
        if not index.isValid() or role != Qt.EditRole:
            return False

        key = self.KEYS[index.column()]

        if key in self.INT_KEYS:
            value = parse_int(value)
        elif key in self.NUMERIC_KEYS:
            value = parse_float(value)
        else:
            value = "" if value is None else str(value)

        self.rows[index.row()][key] = value
        self.dataChanged.emit(index, index, [role])
        return True

    def add_row(self, row: Dict[str, Any]) -> None:
        new = {k: None for k in self.KEYS}
        new.update(row or {})

        for k in self.INT_KEYS:
            new[k] = parse_int(new.get(k))
        for k in self.NUMERIC_KEYS:
            if k not in self.INT_KEYS:
                new[k] = parse_float(new.get(k))

        pos = len(self.rows)
        self.beginInsertRows(QModelIndex(), pos, pos)
        self.rows.append(new)
        self.endInsertRows()

    def remove_rows(self, rows: List[int]) -> None:
        for row in sorted(set(rows), reverse=True):
            if 0 <= row < len(self.rows):
                self.beginRemoveRows(QModelIndex(), row, row)
                del self.rows[row]
                self.endRemoveRows()

    def set_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.beginResetModel()
        self.rows = rows if rows is not None else []
        self.endResetModel()

    def clear(self) -> None:
        self.set_rows([])


class AssignmentTableModel(TableModelBase):
    KEYS = [
        "residue",
        "resname",
        "atom",
        "condition",
        "shift",
        "intensity",
        "integral",
        "ss",
        "deviation",
        "note",
    ]
    HEADERS = [
        "Residue",
        "ResName",
        "Atom",
        "Condition",
        "Shift",
        "Intensity",
        "Integral",
        "SS",
        "Deviation",
        "Note",
    ]
    INT_KEYS = {"residue"}
    NUMERIC_KEYS = {"shift", "intensity", "integral", "deviation"}

    def update_or_add(
        self,
        residue: Any,
        atom: Any,
        condition: Any,
        shift: Any = None,
        intensity: Any = None,
        integral: Any = None,
        ss: Any = None,
        note: Any = None,
    ) -> None:
        residue_i = parse_int(residue)
        atom_n = normalize_atom(atom)
        condition_s = str(condition or "")

        if residue_i is None:
            return

        for i, row in enumerate(self.rows):
            if (
                parse_int(row.get("residue")) == residue_i
                and normalize_atom(row.get("atom")) == atom_n
                and str(row.get("condition") or "") == condition_s
            ):
                if shift is not None:
                    row["shift"] = parse_float(shift)
                if intensity is not None:
                    row["intensity"] = parse_float(intensity)
                if integral is not None:
                    row["integral"] = parse_float(integral)
                if ss:
                    row["ss"] = ss
                if note:
                    row["note"] = note

                left = self.index(i, 0)
                right = self.index(i, self.columnCount() - 1)
                self.dataChanged.emit(left, right, [Qt.EditRole])
                return

        self.add_row(
            {
                "residue": residue_i,
                "resname": "UNK",
                "atom": atom_n,
                "condition": condition_s,
                "shift": parse_float(shift),
                "intensity": parse_float(intensity),
                "integral": parse_float(integral),
                "ss": ss or "coil",
                "deviation": None,
                "note": note or "",
            }
        )


class ParameterTableModel(TableModelBase):
    KEYS = [
        "residue",
        "parameter",
        "value",
        "error",
        "units",
        "condition",
        "note",
    ]
    HEADERS = [
        "Residue",
        "Parameter",
        "Value",
        "Error",
        "Units",
        "Condition",
        "Note",
    ]
    INT_KEYS = {"residue"}
    NUMERIC_KEYS = {"value", "error"}


class PeakTableModel(TableModelBase):
    KEYS = [
        "peak_id",
        "condition",
        "assignment",
        "residue",
        "atom",
        "wh",
        "wn",
        "height",
        "volume",
    ]
    HEADERS = [
        "Peak ID",
        "Condition",
        "Assignment",
        "Residue",
        "Atom",
        "wH",
        "wN",
        "Height",
        "Volume",
    ]
    INT_KEYS = {"peak_id", "residue"}
    NUMERIC_KEYS = {"wh", "wn", "height", "volume"}

    def add_row(self, row: Dict[str, Any]) -> None:
        if row.get("peak_id") is None:
            row["peak_id"] = self.rowCount() + 1
        super().add_row(row)


class ResidueFilterProxy(QSortFilterProxyModel):
    def __init__(self, residue_column: int = 0, parent=None):
        super().__init__(parent)
        self.residue_column = residue_column
        self._residue: Optional[int] = None

    def set_residue(self, residue: Optional[int]) -> None:
        self._residue = parse_int(residue)
        self.invalidateFilter()

    def filterAcceptsRow(self, source_row: int, source_parent: QModelIndex) -> bool:
        if self._residue is None:
            return True

        model = self.sourceModel()
        if model is None:
            return True

        idx = model.index(source_row, self.residue_column)
        value = idx.data(Qt.EditRole)
        return parse_int(value) == self._residue


# ---------------------------------------------------------------------
# Small widgets
# ---------------------------------------------------------------------

class ColorButton(QPushButton):
    colorChanged = Signal(str)

    def __init__(self, color: str, parent=None):
        super().__init__(parent)
        self._color = color
        self.clicked.connect(self._choose_color)
        self._update_appearance()

    def color(self) -> str:
        return self._color

    def set_color(self, color: str, emit: bool = True) -> None:
        if not color:
            color = "#000000"
        self._color = color
        self._update_appearance()
        if emit:
            self.colorChanged.emit(self._color)

    def _update_appearance(self) -> None:
        self.setText(self._color)
        self.setStyleSheet(
            f"background-color: {self._color}; color: black; border: 1px solid #777;"
        )

    def _choose_color(self) -> None:
        initial = QColor(self._color)
        if not initial.isValid():
            initial = QColor("black")

        color = QColorDialog.getColor(initial, self, "Select color")
        if color.isValid():
            self.set_color(color.name())


def attach_scroll_zoom(canvas: FigureCanvas) -> None:
    def on_scroll(event):
        if event.inaxes is None:
            return

        ax = event.inaxes
        if event.xdata is None or event.ydata is None:
            return

        scale = 0.8 if event.button == "up" else 1.25

        xlim = ax.get_xlim()
        ylim = ax.get_ylim()

        xcenter = event.xdata
        ycenter = event.ydata

        xwidth = (xlim[1] - xlim[0]) * scale
        ywidth = (ylim[1] - ylim[0]) * scale

        ax.set_xlim(xcenter - xwidth / 2.0, xcenter + xwidth / 2.0)
        ax.set_ylim(ycenter - ywidth / 2.0, ycenter + ywidth / 2.0)
        canvas.draw_idle()

    canvas.mpl_connect("scroll_event", on_scroll)


# ---------------------------------------------------------------------
# 3D visualization widget
# ---------------------------------------------------------------------

class VisualizationWidget(QWidget):
    focusToggled = Signal(bool)
    residuePicked = Signal(int)
    paintRequested = Signal(str)
    currentResidueChanged = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)

        self.atoms: List[PdbAtom] = []
        self.ss_map: Dict[int, str] = {}
        self.current_residue: Optional[int] = None
        self._scatter_residues: List[int] = []
        self._block_spin = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)

        toolbar = QHBoxLayout()

        toolbar.addWidget(QLabel("Residue"))
        self.spin_from = QSpinBox()
        self.spin_from.setRange(0, 99999)
        self.spin_from.setValue(0)
        self.spin_from.setToolTip("Selected residue / start of painting range")
        toolbar.addWidget(self.spin_from)

        toolbar.addWidget(QLabel("-"))
        self.spin_to = QSpinBox()
        self.spin_to.setRange(0, 99999)
        self.spin_to.setValue(0)
        self.spin_to.setToolTip("End of painting range")
        toolbar.addWidget(self.spin_to)

        self.focus_button = QToolButton()
        self.focus_button.setText("Focus")
        self.focus_button.setCheckable(True)
        self.focus_button.setToolTip(
            "Synchronized with the peak filter. "
            "When active, tables without the selected residue are hidden."
        )
        toolbar.addWidget(self.focus_button)

        toolbar.addWidget(QLabel("Paint:"))

        self.btn_paint_coil = QPushButton("Random coil")
        self.btn_paint_helix = QPushButton("Alpha helix")
        self.btn_paint_beta = QPushButton("Beta sheet")

        toolbar.addWidget(self.btn_paint_coil)
        toolbar.addWidget(self.btn_paint_helix)
        toolbar.addWidget(self.btn_paint_beta)
        toolbar.addStretch(1)

        layout.addLayout(toolbar)

        self.figure = Figure()
        self.canvas = FigureCanvas(self.figure)
        self.ax = self.figure.add_subplot(projection="3d")

        layout.addWidget(self.canvas)

        self.focus_button.toggled.connect(self._on_focus_toggled)
        self.btn_paint_coil.clicked.connect(lambda: self.paintRequested.emit("coil"))
        self.btn_paint_helix.clicked.connect(lambda: self.paintRequested.emit("alpha"))
        self.btn_paint_beta.clicked.connect(lambda: self.paintRequested.emit("beta"))
        self.spin_from.valueChanged.connect(self._on_spin_changed)
        self.spin_to.valueChanged.connect(self._on_spin_changed)
        self.canvas.mpl_connect("pick_event", self._on_pick)

        self._redraw()

    def _on_focus_toggled(self, checked: bool) -> None:
        self.focusToggled.emit(checked)

    def set_focus_checked(self, checked: bool) -> None:
        self.focus_button.blockSignals(True)
        self.focus_button.setChecked(bool(checked))
        self.focus_button.blockSignals(False)

    def residue_range(self) -> range:
        a = int(self.spin_from.value())
        b = int(self.spin_to.value())

        if a <= 0:
            return range(0)

        if b < a:
            b = a

        return range(a, b + 1)

    def current_residue_value(self) -> int:
        return int(self.spin_from.value())

    def set_current_residue(self, residue: Optional[int]) -> None:
        residue_i = parse_int(residue)
        if residue_i is None:
            return

        self._block_spin = True
        self.spin_from.setValue(residue_i)
        if self.spin_to.value() < residue_i:
            self.spin_to.setValue(residue_i)
        self._block_spin = False

        self.current_residue = residue_i
        self._redraw()

    def _on_spin_changed(self) -> None:
        if self._block_spin:
            return

        res = int(self.spin_from.value())
        if self.spin_to.value() < res:
            self.spin_to.blockSignals(True)
            self.spin_to.setValue(res)
            self.spin_to.blockSignals(False)

        self.current_residue = res
        self.currentResidueChanged.emit(res)
        self._redraw()

    def load_pdb_text(self, text: str) -> None:
        self.atoms = parse_pdb_text(text or "")

        if self.atoms:
            max_res = max(a.residue for a in self.atoms)
            self.spin_from.setMaximum(max(99999, max_res + 1))
            self.spin_to.setMaximum(max(99999, max_res + 1))

            if self.spin_to.value() == 0:
                self.spin_to.setValue(max_res)

        self._redraw()

    def update_secondary_structure(self, ss_map: Dict[int, str]) -> None:
        self.ss_map = dict(ss_map or {})
        self._redraw()

    def _on_pick(self, event) -> None:
        indices = getattr(event, "ind", [])
        if not len(indices):
            return

        idx = int(indices[0])
        if 0 <= idx < len(self._scatter_residues):
            res = int(self._scatter_residues[idx])
            self.set_current_residue(res)
            self.residuePicked.emit(res)

    def _redraw(self) -> None:
        self.ax.clear()
        self._scatter_residues = []

        if not self.atoms:
            self.ax.set_title("No PDB loaded", fontsize=10)
            self.canvas.draw_idle()
            return

        xs, ys, zs, residues, colors = [], [], [], [], []

        for atom in self.atoms:
            xs.append(atom.x)
            ys.append(atom.y)
            zs.append(atom.z)
            residues.append(atom.residue)

            ss = self.ss_map.get(atom.residue, "coil")
            colors.append(SS_COLORS.get(ss, SS_COLORS["coil"]))

        self.ax.scatter(
            xs,
            ys,
            zs,
            c=colors,
            s=16,
            picker=True,
        )

        self._scatter_residues = residues

        if self.current_residue is not None:
            hx, hy, hz = [], [], []
            for atom in self.atoms:
                if atom.residue == self.current_residue:
                    hx.append(atom.x)
                    hy.append(atom.y)
                    hz.append(atom.z)

            if hx:
                self.ax.scatter(hx, hy, hz, c="magenta", s=55)

        self.ax.set_xlabel("X")
        self.ax.set_ylabel("Y")
        self.ax.set_zlabel("Z")
        self.ax.set_title("3D structure")

        self.canvas.draw_idle()


# ---------------------------------------------------------------------
# CSI plot widget
# ---------------------------------------------------------------------

class CSIWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.data: List[Dict[str, Any]] = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)

        options_group = QGroupBox("CSI graphics")
        grid = QGridLayout(options_group)

        self.font_size = QSpinBox()
        self.font_size.setRange(6, 36)
        self.font_size.setValue(10)

        self.positive_color = ColorButton("#d62728")
        self.negative_color = ColorButton("#1f77b4")

        self.hlines = QLineEdit("-0.5,0.5")
        self.x_title = QLineEdit("Residue")
        self.y_title = QLineEdit("Chemical shift index")

        self.x_y_ratio = QDoubleSpinBox()
        self.x_y_ratio.setRange(0.2, 10.0)
        self.x_y_ratio.setSingleStep(0.1)
        self.x_y_ratio.setValue(2.0)

        self.grid_check = QCheckBox("Grid")
        self.grid_check.setChecked(True)

        row = 0
        grid.addWidget(QLabel("Font size"), row, 0)
        grid.addWidget(self.font_size, row, 1)
        grid.addWidget(QLabel("Positive color"), row, 2)
        grid.addWidget(self.positive_color, row, 3)
        grid.addWidget(QLabel("Negative color"), row, 4)
        grid.addWidget(self.negative_color, row, 5)

        row += 1
        grid.addWidget(QLabel("Horizontal lines"), row, 0)
        grid.addWidget(self.hlines, row, 1, 1, 3)
        grid.addWidget(QLabel("X/Y ratio"), row, 4)
        grid.addWidget(self.x_y_ratio, row, 5)

        row += 1
        grid.addWidget(QLabel("X axis title"), row, 0)
        grid.addWidget(self.x_title, row, 1, 1, 2)
        grid.addWidget(QLabel("Y axis title"), row, 3)
        grid.addWidget(self.y_title, row, 4, 1, 2)
        grid.addWidget(self.grid_check, row, 6)

        layout.addWidget(options_group)

        self.figure = Figure()
        self.canvas = FigureCanvas(self.figure)
        self.toolbar = NavigationToolbar(self.canvas, self)

        layout.addWidget(self.toolbar)
        layout.addWidget(self.canvas)

        attach_scroll_zoom(self.canvas)

        self.font_size.valueChanged.connect(self.update_plot)
        self.positive_color.colorChanged.connect(lambda c: self.update_plot())
        self.negative_color.colorChanged.connect(lambda c: self.update_plot())
        self.hlines.textChanged.connect(lambda t: self.update_plot())
        self.x_title.textChanged.connect(lambda t: self.update_plot())
        self.y_title.textChanged.connect(lambda t: self.update_plot())
        self.x_y_ratio.valueChanged.connect(lambda v: self.update_plot())
        self.grid_check.toggled.connect(lambda c: self.update_plot())

        self.update_plot()

    def get_options(self) -> CSIOptions:
        return CSIOptions(
            font_size=int(self.font_size.value()),
            positive_color=self.positive_color.color(),
            negative_color=self.negative_color.color(),
            hlines=self.hlines.text(),
            x_title=self.x_title.text(),
            y_title=self.y_title.text(),
            x_y_ratio=float(self.x_y_ratio.value()),
            show_grid=bool(self.grid_check.isChecked()),
        )

    def set_options(self, options: CSIOptions) -> None:
        self.font_size.blockSignals(True)
        self.positive_color.blockSignals(True)
        self.negative_color.blockSignals(True)
        self.hlines.blockSignals(True)
        self.x_title.blockSignals(True)
        self.y_title.blockSignals(True)
        self.x_y_ratio.blockSignals(True)
        self.grid_check.blockSignals(True)

        self.font_size.setValue(int(options.font_size))
        self.positive_color.set_color(options.positive_color, emit=False)
        self.negative_color.set_color(options.negative_color, emit=False)
        self.hlines.setText(str(options.hlines))
        self.x_title.setText(str(options.x_title))
        self.y_title.setText(str(options.y_title))
        self.x_y_ratio.setValue(float(options.x_y_ratio))
        self.grid_check.setChecked(bool(options.show_grid))

        self.font_size.blockSignals(False)
        self.positive_color.blockSignals(False)
        self.negative_color.blockSignals(False)
        self.hlines.blockSignals(False)
        self.x_title.blockSignals(False)
        self.y_title.blockSignals(False)
        self.x_y_ratio.blockSignals(False)
        self.grid_check.blockSignals(False)

        self.update_plot()

    def set_data(self, data: List[Dict[str, Any]]) -> None:
        self.data = data or []
        self.update_plot()

    def update_plot(self) -> None:
        opts = self.get_options()

        base_height = 4.0
        width = max(2.0, base_height * float(opts.x_y_ratio))
        self.figure.set_size_inches(width, base_height, forward=True)
        self.figure.clear()

        ax = self.figure.add_subplot(111)

        if not self.data:
            ax.text(
                0.5,
                0.5,
                "No CSI data",
                ha="center",
                va="center",
                fontsize=opts.font_size,
            )
            ax.set_xlabel(opts.x_title, fontsize=opts.font_size)
            ax.set_ylabel(opts.y_title, fontsize=opts.font_size)
            self.figure.tight_layout()
            self.canvas.draw_idle()
            return

        x = [parse_int(d.get("residue")) or 0 for d in self.data]
        y = [parse_float(d.get("value")) or 0.0 for d in self.data]

        colors = [
            opts.positive_color if value >= 0 else opts.negative_color
            for value in y
        ]

        ax.bar(x, y, color=colors, width=0.7)
        ax.axhline(0.0, color="black", linewidth=0.8)

        for h in parse_hlines(opts.hlines):
            ax.axhline(h, color="gray", linestyle="--", linewidth=1.0)

        ax.set_title("Chemical shift index", fontsize=opts.font_size)
        ax.set_xlabel(opts.x_title, fontsize=opts.font_size)
        ax.set_ylabel(opts.y_title, fontsize=opts.font_size)
        ax.tick_params(labelsize=opts.font_size)

        if opts.show_grid:
            ax.grid(True, axis="y", alpha=0.3)

        self.figure.tight_layout()
        self.canvas.draw_idle()


# ---------------------------------------------------------------------
# Fit result widget
# ---------------------------------------------------------------------

class FitWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.fit_x: List[float] = []
        self.fit_y: List[float] = []
        self._loading = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)

        controls_group = QGroupBox("Fit graphics")
        grid = QGridLayout(controls_group)

        self.font_size = QSpinBox()
        self.font_size.setRange(6, 36)
        self.font_size.setValue(10)

        self.marker_color = ColorButton("#1f77b4")
        self.error_color = ColorButton("#555555")

        self.capsize = QSpinBox()
        self.capsize.setRange(0, 20)
        self.capsize.setValue(4)

        self.hlines = QLineEdit("")
        self.x_title = QLineEdit("Fitted parameter")
        self.y_title = QLineEdit("Optimized value")

        self.x_y_ratio = QDoubleSpinBox()
        self.x_y_ratio.setRange(0.2, 10.0)
        self.x_y_ratio.setSingleStep(0.1)
        self.x_y_ratio.setValue(1.5)

        self.grid_check = QCheckBox("Grid")
        self.grid_check.setChecked(True)

        row = 0
        grid.addWidget(QLabel("Font size"), row, 0)
        grid.addWidget(self.font_size, row, 1)
        grid.addWidget(QLabel("Marker color"), row, 2)
        grid.addWidget(self.marker_color, row, 3)
        grid.addWidget(QLabel("Error color"), row, 4)
        grid.addWidget(self.error_color, row, 5)

        row += 1
        grid.addWidget(QLabel("Horizontal lines"), row, 0)
        grid.addWidget(self.hlines, row, 1, 1, 2)
        grid.addWidget(QLabel("Cap size"), row, 3)
        grid.addWidget(self.capsize, row, 4)
        grid.addWidget(QLabel("X/Y ratio"), row, 5)
        grid.addWidget(self.x_y_ratio, row, 6)

        row += 1
        grid.addWidget(QLabel("X axis title"), row, 0)
        grid.addWidget(self.x_title, row, 1, 1, 2)
        grid.addWidget(QLabel("Y axis title"), row, 3)
        grid.addWidget(self.y_title, row, 4, 1, 2)
        grid.addWidget(self.grid_check, row, 6)

        layout.addWidget(controls_group)

        button_layout = QHBoxLayout()
        self.btn_add_result = QPushButton("Add result")
        self.btn_remove_result = QPushButton("Remove selected")
        self.btn_simple_fit = QPushButton("Run simple linear fit from CSI")
        button_layout.addWidget(self.btn_add_result)
        button_layout.addWidget(self.btn_remove_result)
        button_layout.addWidget(self.btn_simple_fit)
        button_layout.addStretch(1)
        layout.addLayout(button_layout)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["Parameter", "Value", "Error"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.itemChanged.connect(self._on_table_item_changed)
        layout.addWidget(self.table)

        self.figure = Figure()
        self.canvas = FigureCanvas(self.figure)
        self.toolbar = NavigationToolbar(self.canvas, self)

        layout.addWidget(self.toolbar)
        layout.addWidget(self.canvas)

        attach_scroll_zoom(self.canvas)

        self.btn_add_result.clicked.connect(self.add_result_from_ui)
        self.btn_remove_result.clicked.connect(self.remove_selected_result)
        self.btn_simple_fit.clicked.connect(self.run_simple_fit)

        self.font_size.valueChanged.connect(self.update_plot)
        self.marker_color.colorChanged.connect(lambda c: self.update_plot())
        self.error_color.colorChanged.connect(lambda c: self.update_plot())
        self.capsize.valueChanged.connect(lambda v: self.update_plot())
        self.hlines.textChanged.connect(lambda t: self.update_plot())
        self.x_title.textChanged.connect(lambda t: self.update_plot())
        self.y_title.textChanged.connect(lambda t: self.update_plot())
        self.x_y_ratio.valueChanged.connect(lambda v: self.update_plot())
        self.grid_check.toggled.connect(lambda c: self.update_plot())

        self.update_plot()

    def _on_table_item_changed(self, item) -> None:
        if not self._loading:
            self.update_plot()

    def get_options(self) -> FitOptions:
        return FitOptions(
            font_size=int(self.font_size.value()),
            marker_color=self.marker_color.color(),
            error_color=self.error_color.color(),
            capsize=int(self.capsize.value()),
            hlines=self.hlines.text(),
            x_title=self.x_title.text(),
            y_title=self.y_title.text(),
            x_y_ratio=float(self.x_y_ratio.value()),
            show_grid=bool(self.grid_check.isChecked()),
        )

    def set_options(self, options: FitOptions) -> None:
        self.font_size.blockSignals(True)
        self.marker_color.blockSignals(True)
        self.error_color.blockSignals(True)
        self.capsize.blockSignals(True)
        self.hlines.blockSignals(True)
        self.x_title.blockSignals(True)
        self.y_title.blockSignals(True)
        self.x_y_ratio.blockSignals(True)
        self.grid_check.blockSignals(True)

        self.font_size.setValue(int(options.font_size))
        self.marker_color.set_color(options.marker_color, emit=False)
        self.error_color.set_color(options.error_color, emit=False)
        self.capsize.setValue(int(options.capsize))
        self.hlines.setText(str(options.hlines))
        self.x_title.setText(str(options.x_title))
        self.y_title.setText(str(options.y_title))
        self.x_y_ratio.setValue(float(options.x_y_ratio))
        self.grid_check.setChecked(bool(options.show_grid))

        self.font_size.blockSignals(False)
        self.marker_color.blockSignals(False)
        self.error_color.blockSignals(False)
        self.capsize.blockSignals(False)
        self.hlines.blockSignals(False)
        self.x_title.blockSignals(False)
        self.y_title.blockSignals(False)
        self.x_y_ratio.blockSignals(False)
        self.grid_check.blockSignals(False)

        self.update_plot()

    def add_result(
        self,
        parameter: str,
        value: Any,
        error: Any,
        update_plot: bool = True,
    ) -> None:
        row = self.table.rowCount()
        self.table.insertRow(row)

        self.table.setItem(row, 0, QTableWidgetItem(str(parameter)))
        self.table.setItem(row, 1, QTableWidgetItem("" if value is None else str(value)))
        self.table.setItem(row, 2, QTableWidgetItem("" if error is None else str(error)))

        if update_plot:
            self.update_plot()

    def add_result_from_ui(self) -> None:
        self.add_result("parameter", 0.0, 0.0)

    def remove_selected_result(self) -> None:
        rows = sorted({idx.row() for idx in self.table.selectedIndexes()}, reverse=True)
        for row in rows:
            self.table.removeRow(row)
        self.update_plot()

    def get_results(self) -> List[Dict[str, Any]]:
        results = []
        for row in range(self.table.rowCount()):
            name_item = self.table.item(row, 0)
            value_item = self.table.item(row, 1)
            error_item = self.table.item(row, 2)

            name = name_item.text().strip() if name_item else f"parameter_{row+1}"
            value = parse_float(value_item.text()) if value_item else None
            error = parse_float(error_item.text()) if error_item else None

            results.append(
                {
                    "parameter": name or f"parameter_{row+1}",
                    "value": value,
                    "error": error,
                }
            )
        return results

    def set_results(self, results: List[Dict[str, Any]]) -> None:
        self._loading = True
        self.table.setRowCount(0)

        for r in results or []:
            self.add_result(
                r.get("parameter", ""),
                r.get("value", None),
                r.get("error", None),
                update_plot=False,
            )

        self._loading = False
        self.update_plot()

    def set_fit_data(self, x: List[Any], y: List[Any]) -> None:
        self.fit_x = [parse_float(v) for v in x or []]
        self.fit_y = [parse_float(v) for v in y or []]

    def run_simple_fit(self) -> None:
        x = np.asarray([v for v in self.fit_x if v is not None], dtype=float)
        y = np.asarray([v for v in self.fit_y if v is not None], dtype=float)

        if x.size == 0 or y.size == 0 or x.size != y.size:
            QMessageBox.warning(
                self,
                "Fit",
                "No paired CSI data available for fitting.",
            )
            return

        mask = np.isfinite(x) & np.isfinite(y)
        x = x[mask]
        y = y[mask]

        if x.size < 3:
            QMessageBox.warning(
                self,
                "Fit",
                "At least three finite data points are required for a simple linear fit.",
            )
            return

        if np.allclose(x, x[0]):
            QMessageBox.warning(
                self,
                "Fit",
                "All x values are identical; cannot fit.",
            )
            return

        try:
            coeffs, cov = np.polyfit(x, y, 1, cov=True)
        except Exception as exc:
            QMessageBox.warning(self, "Fit", f"Fit failed: {exc}")
            return

        residuals = y - np.polyval(coeffs, x)
        dof = max(x.size - 2, 1)
        rss = float(np.sum(residuals**2))

        if cov is None:
            var = rss / dof
            X = np.vstack([x, np.ones_like(x)]).T
            try:
                cov = var * np.linalg.inv(X.T @ X)
            except Exception:
                cov = np.diag([var, var])

        errors = np.sqrt(np.diag(cov)) if cov is not None else np.array([np.nan, np.nan])

        self.add_result("slope", float(coeffs[0]), float(errors[0]), update_plot=False)
        self.add_result("intercept", float(coeffs[1]), float(errors[1]), update_plot=True)

    def update_plot(self) -> None:
        opts = self.get_options()

        base_height = 4.0
        width = max(2.0, base_height * float(opts.x_y_ratio))
        self.figure.set_size_inches(width, base_height, forward=True)
        self.figure.clear()

        ax = self.figure.add_subplot(111)
        results = self.get_results()

        if not results:
            ax.text(
                0.5,
                0.5,
                "No fitted parameters",
                ha="center",
                va="center",
                fontsize=opts.font_size,
            )
            ax.set_xlabel(opts.x_title, fontsize=opts.font_size)
            ax.set_ylabel(opts.y_title, fontsize=opts.font_size)
            self.figure.tight_layout()
            self.canvas.draw_idle()
            return

        names = [r["parameter"] for r in results]
        values = []
        errors = []

        for r in results:
            v = parse_float(r.get("value"))
            e = parse_float(r.get("error"))
            values.append(0.0 if v is None else v)

            if e is None or not np.isfinite(e):
                errors.append(0.0)
            else:
                errors.append(float(e))

        x_positions = np.arange(len(values))

        ax.errorbar(
            x_positions,
            values,
            yerr=errors,
            fmt="o",
            color=opts.marker_color,
            ecolor=opts.error_color,
            capsize=int(opts.capsize),
            capthick=1.5,
            elinewidth=1.5,
        )

        ax.set_xticks(x_positions)
        ax.set_xticklabels(names, rotation=45, ha="right", fontsize=max(6, opts.font_size - 1))

        for h in parse_hlines(opts.hlines):
            ax.axhline(h, color="gray", linestyle="--", linewidth=1.0)

        ax.set_title("Optimized fitted parameters", fontsize=opts.font_size)
        ax.set_xlabel(opts.x_title, fontsize=opts.font_size)
        ax.set_ylabel(opts.y_title, fontsize=opts.font_size)
        ax.tick_params(labelsize=opts.font_size)

        if opts.show_grid:
            ax.grid(True, axis="y", alpha=0.3)

        self.figure.tight_layout()
        self.canvas.draw_idle()


# ---------------------------------------------------------------------
# Sparky import dialog
# ---------------------------------------------------------------------

class SparkyImportDialog(QDialog):
    def __init__(self, conditions: List[str], parent=None):
        super().__init__(parent)

        self.setWindowTitle("Import Sparky peak list / assignment")
        self.resize(760, 560)

        self.header: List[str] = []
        self.records: List[List[str]] = []

        layout = QVBoxLayout(self)

        form = QFormLayout()

        file_widget = QWidget()
        file_layout = QHBoxLayout(file_widget)
        file_layout.setContentsMargins(0, 0, 0, 0)

        self.file_edit = QLineEdit()
        self.file_edit.setPlaceholderText("Select Sparky .list, .txt, .peaks, or assignment file")
        self.btn_browse = QPushButton("Browse...")

        file_layout.addWidget(self.file_edit)
        file_layout.addWidget(self.btn_browse)

        self.condition_edit = QComboBox()
        self.condition_edit.setEditable(True)
        if conditions:
            self.condition_edit.addItems(conditions)
        else:
            self.condition_edit.addItem("condition_1")

        self.auto_shift_check = QCheckBox(
            "Auto-import recognized shift columns (wH, wN, wC, CA, CB, HA, shift)"
        )
        self.auto_shift_check.setChecked(True)

        self.import_peaks_check = QCheckBox("Create peak table rows")
        self.import_peaks_check.setChecked(True)

        self.update_assignment_check = QCheckBox("Update assignment table")
        self.update_assignment_check.setChecked(True)

        self.res_combo = QComboBox()
        self.atom_combo = QComboBox()
        self.shift_combo = QComboBox()
        self.intensity_combo = QComboBox()
        self.integral_combo = QComboBox()

        form.addRow("File", file_widget)
        form.addRow("Condition", self.condition_edit)
        form.addRow("Residue column", self.res_combo)
        form.addRow("Atom/assignment column", self.atom_combo)
        form.addRow("Chemical shift column", self.shift_combo)
        form.addRow("Intensity/height column", self.intensity_combo)
        form.addRow("Integral/volume column", self.integral_combo)
        form.addRow(self.auto_shift_check)
        form.addRow(self.import_peaks_check)
        form.addRow(self.update_assignment_check)

        layout.addLayout(form)

        layout.addWidget(QLabel("Preview"))
        self.preview = QTableWidget()
        self.preview.setEditTriggers(QAbstractItemView.NoEditTriggers)
        layout.addWidget(self.preview)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.btn_browse.clicked.connect(self.browse_file)
        self.file_edit.textChanged.connect(self.load_file)
        self.auto_shift_check.toggled.connect(self._update_shift_combo_state)

        self._update_shift_combo_state()

    def browse_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Open Sparky file",
            "",
            "Sparky/text files (*.list *.txt *.peaks *.assign *.csv);;All files (*)",
        )
        if path:
            self.file_edit.setText(path)

    def load_file(self, path: Optional[str] = None) -> None:
        if isinstance(path, str):
            file_path = path
        else:
            file_path = self.file_edit.text().strip()

        if not file_path or not os.path.exists(file_path):
            self.header = []
            self.records = []
            self.preview.clear()
            self.preview.setRowCount(0)
            self.preview.setColumnCount(0)
            return

        try:
            with open(file_path, "r", errors="replace") as fh:
                text = fh.read()
        except Exception as exc:
            QMessageBox.warning(self, "Import error", str(exc))
            return

        self.header, self.records = parse_sparky_table(text)
        self._populate_combos()
        self._fill_preview()

    def _guess_column(self, keywords: List[str]) -> int:
        for i, h in enumerate(self.header):
            low = str(h).lower()
            if any(k in low for k in keywords):
                return i
        return -1

    def _populate_combo(self, combo: QComboBox, selected: int) -> None:
        combo.blockSignals(True)
        combo.clear()
        combo.addItem("Do not import")
        combo.addItems([str(h) for h in self.header])

        if selected is not None and 0 <= selected < len(self.header):
            combo.setCurrentIndex(selected + 1)
        else:
            combo.setCurrentIndex(0)

        combo.blockSignals(False)

    def _populate_combos(self) -> None:
        res_guess = self._guess_column(
            ["residue", "res", "seq", "assignment", "number", "no"]
        )
        atom_guess = self._guess_column(["atom", "type", "name", "assignment"])
        shift_guess = self._guess_column(
            ["shift", "ppm", "wh", "wn", "wc", "ca", "cb", "ha"]
        )
        intensity_guess = self._guess_column(["height", "intensity"])
        integral_guess = self._guess_column(["volume", "integral", "vol"])

        self._populate_combo(self.res_combo, res_guess)
        self._populate_combo(self.atom_combo, atom_guess)
        self._populate_combo(self.shift_combo, shift_guess)
        self._populate_combo(self.intensity_combo, intensity_guess)
        self._populate_combo(self.integral_combo, integral_guess)

        self._update_shift_combo_state()

    def _fill_preview(self) -> None:
        self.preview.clear()

        if not self.header:
            self.preview.setRowCount(0)
            self.preview.setColumnCount(0)
            return

        self.preview.setColumnCount(len(self.header))
        self.preview.setHorizontalHeaderLabels([str(h) for h in self.header])

        n_rows = min(8, len(self.records))
        self.preview.setRowCount(n_rows)

        for r in range(n_rows):
            for c, value in enumerate(self.records[r][: len(self.header)]):
                item = QTableWidgetItem(str(value))
                item.setFlags(item.flags() & ~Qt.ItemIsEditable)
                self.preview.setItem(r, c, item)

        self.preview.resizeColumnsToContents()

    def _update_shift_combo_state(self) -> None:
        self.shift_combo.setEnabled(not self.auto_shift_check.isChecked())

    def get_result(self) -> Dict[str, Any]:
        return {
            "path": self.file_edit.text().strip(),
            "condition": self.condition_edit.currentText().strip() or "imported",
            "res_col": self.res_combo.currentIndex() - 1,
            "atom_col": self.atom_combo.currentIndex() - 1,
            "shift_col": self.shift_combo.currentIndex() - 1,
            "intensity_col": self.intensity_combo.currentIndex() - 1,
            "integral_col": self.integral_combo.currentIndex() - 1,
            "auto_shifts": bool(self.auto_shift_check.isChecked()),
            "import_peaks": bool(self.import_peaks_check.isChecked()),
            "update_assignment": bool(self.update_assignment_check.isChecked()),
        }


# ---------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("NMR assignment / CSI / fitting dataset")
        self.resize(1550, 920)

        self.pdb_text = ""
        self.pdb_filename = ""
        self.conditions = {"condition_1"}

        self.focus_enabled = False
        self.focus_residue: Optional[int] = None
        self._syncing_focus = False

        self._build_models()
        self._build_ui()
        self._connect_ui()

        self.apply_residue_filter()
        self.recalculate_deviations()

    # ------------------------- model/UI construction -------------------------

    def _build_models(self) -> None:
        self.assignment_model = AssignmentTableModel()
        self.parameter_model = ParameterTableModel()
        self.peak_model = PeakTableModel()

        self.assignment_proxy = ResidueFilterProxy(residue_column=0)
        self.assignment_proxy.setSourceModel(self.assignment_model)

        self.parameter_proxy = ResidueFilterProxy(residue_column=0)
        self.parameter_proxy.setSourceModel(self.parameter_model)

        self.peak_proxy = ResidueFilterProxy(residue_column=3)
        self.peak_proxy.setSourceModel(self.peak_model)

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)

        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(4, 4, 4, 4)

        splitter = QSplitter(Qt.Horizontal)
        main_layout.addWidget(splitter)

        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 0, 0)

        # Assignment table group
        self.assignment_group = QGroupBox("Assignment table")
        assignment_layout = QVBoxLayout(self.assignment_group)

        self.assignment_table = QTableView()
        self.assignment_table.setModel(self.assignment_proxy)
        self.assignment_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.assignment_table.setSortingEnabled(True)
        self.assignment_table.horizontalHeader().setStretchLastSection(True)
        self.assignment_table.verticalHeader().setVisible(False)
        assignment_layout.addWidget(self.assignment_table)

        assignment_buttons = QHBoxLayout()
        self.btn_add_assignment = QPushButton("Add row")
        self.btn_del_assignment = QPushButton("Delete selected")
        self.btn_recalc_deviations = QPushButton("Recalculate deviations")
        assignment_buttons.addWidget(self.btn_add_assignment)
        assignment_buttons.addWidget(self.btn_del_assignment)
        assignment_buttons.addWidget(self.btn_recalc_deviations)
        assignment_buttons.addStretch(1)
        assignment_layout.addLayout(assignment_buttons)

        self.force_ss_check = QCheckBox(
            "Force deviations to match painted secondary structure"
        )
        self.force_ss_check.setChecked(True)
        self.force_ss_check.setToolTip(
            "If enabled, painted secondary structure directly determines displayed deviations. "
            "If disabled, deviations are calculated from experimental shifts versus random coil."
        )
        assignment_layout.addWidget(self.force_ss_check)

        # Parameter Layer group (moved after assignment table)
        self.parameter_group = QGroupBox("Parameter Layer (assignment table data type)")
        parameter_layout = QVBoxLayout(self.parameter_group)

        self.parameter_table = QTableView()
        self.parameter_table.setModel(self.parameter_proxy)
        self.parameter_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.parameter_table.setSortingEnabled(True)
        self.parameter_table.horizontalHeader().setStretchLastSection(True)
        self.parameter_table.verticalHeader().setVisible(False)
        parameter_layout.addWidget(self.parameter_table)

        parameter_buttons = QHBoxLayout()
        self.btn_add_parameter = QPushButton("Add parameter")
        self.btn_del_parameter = QPushButton("Delete selected")
        parameter_buttons.addWidget(self.btn_add_parameter)
        parameter_buttons.addWidget(self.btn_del_parameter)
        parameter_buttons.addStretch(1)
        parameter_layout.addLayout(parameter_buttons)

        # Peaks group
        self.peaks_group = QGroupBox("Peaks")
        peaks_layout = QVBoxLayout(self.peaks_group)

        peaks_toolbar = QHBoxLayout()

        self.btn_filter_peaks = QToolButton()
        self.btn_filter_peaks.setText("Filter peaks")
        self.btn_filter_peaks.setCheckable(True)
        self.btn_filter_peaks.setToolTip(
            "Synchronized with the Focus button next to the 3D visualization."
        )

        self.btn_import_sparky = QPushButton("Import Sparky...")

        peaks_toolbar.addWidget(self.btn_filter_peaks)
        peaks_toolbar.addWidget(self.btn_import_sparky)
        peaks_toolbar.addStretch(1)
        peaks_layout.addLayout(peaks_toolbar)

        self.peak_table = QTableView()
        self.peak_table.setModel(self.peak_proxy)
        self.peak_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.peak_table.setSortingEnabled(True)
        self.peak_table.horizontalHeader().setStretchLastSection(True)
        self.peak_table.verticalHeader().setVisible(False)
        peaks_layout.addWidget(self.peak_table)

        # Add left widgets in requested order:
        # assignment table first, then Parameter Layer, then peaks.
        left_layout.addWidget(self.assignment_group)
        left_layout.addWidget(self.parameter_group)
        left_layout.addWidget(self.peaks_group)
        left_layout.addStretch(1)

        # Right side: 3D view + tabs for CSI / fitting
        right_splitter = QSplitter(Qt.Vertical)

        self.vis_widget = VisualizationWidget()

        self.tabs = QTabWidget()
        self.csi_widget = CSIWidget()
        self.fit_widget = FitWidget()

        self.tabs.addTab(self.csi_widget, "Chemical shift index")
        self.tabs.addTab(self.fit_widget, "Fitting")

        right_splitter.addWidget(self.vis_widget)
        right_splitter.addWidget(self.tabs)
        right_splitter.setStretchFactor(0, 3)
        right_splitter.setStretchFactor(1, 2)

        splitter.addWidget(left)
        splitter.addWidget(right_splitter)
        splitter.setStretchFactor(0, 2)
        splitter.setStretchFactor(1, 3)

        # Menus
        file_menu = self.menuBar().addMenu("File")
        file_menu.addAction("New dataset", self.new_project)
        file_menu.addAction("Open dataset...", self.open_project)
        file_menu.addAction("Save dataset...", self.save_project)
        file_menu.addSeparator()
        file_menu.addAction("Import PDB...", self.import_pdb)
        file_menu.addAction("Import Sparky...", self.import_sparky)
        file_menu.addSeparator()
        file_menu.addAction("Quit", self.close)

        self.statusBar().showMessage("Ready")

    def _connect_ui(self) -> None:
        # Focus/filter synchronization
        self.btn_filter_peaks.toggled.connect(
            lambda checked: self.on_focus_toggled(checked, "peaks")
        )
        self.vis_widget.focusToggled.connect(
            lambda checked: self.on_focus_toggled(checked, "vis")
        )

        # Residue selection/painting
        self.vis_widget.residuePicked.connect(self.on_residue_picked)
        self.vis_widget.paintRequested.connect(self.paint_secondary_structure)
        self.vis_widget.currentResidueChanged.connect(self.on_vis_residue_changed)

        # Assignment table selection
        self.assignment_table.selectionModel().currentRowChanged.connect(
            self.on_assignment_selection
        )

        # Table editing buttons
        self.btn_add_assignment.clicked.connect(self.add_assignment_row)
        self.btn_del_assignment.clicked.connect(self.delete_selected_assignment)
        self.btn_add_parameter.clicked.connect(self.add_parameter_row)
        self.btn_del_parameter.clicked.connect(self.delete_selected_parameter)
        self.btn_recalc_deviations.clicked.connect(self.recalculate_deviations)
        self.force_ss_check.toggled.connect(lambda checked: self.recalculate_deviations())

        # Sparky import
        self.btn_import_sparky.clicked.connect(self.import_sparky)

    # ------------------------- focus/filter behavior -------------------------

    def _sync_focus_controls(self) -> None:
        self._syncing_focus = True
        self.btn_filter_peaks.setChecked(self.focus_enabled)
        self.vis_widget.set_focus_checked(self.focus_enabled)
        self._syncing_focus = False

    def on_focus_toggled(self, checked: bool, source: str = "") -> None:
        if self._syncing_focus:
            return

        self.focus_enabled = bool(checked)

        if self.focus_enabled:
            residue = self.focus_residue or self.vis_widget.current_residue_value()
            residue_i = parse_int(residue)
            if residue_i and residue_i > 0:
                self.focus_residue = residue_i
            else:
                self.focus_residue = None
                self.statusBar().showMessage(
                    "Focus enabled, but no residue is selected.",
                    4000,
                )

        self._sync_focus_controls()
        self.apply_residue_filter()

    def set_focus_residue(self, residue: Any, update_spin: bool = True) -> None:
        residue_i = parse_int(residue)
        if residue_i is None:
            return

        self.focus_residue = residue_i

        if update_spin:
            self.vis_widget.set_current_residue(residue_i)

        if self.focus_enabled:
            self.apply_residue_filter()

    def on_vis_residue_changed(self, residue: int) -> None:
        if self.focus_enabled:
            self.focus_residue = parse_int(residue)
            self.apply_residue_filter()

    def on_assignment_selection(self, current: QModelIndex, previous: QModelIndex) -> None:
        if not current.isValid():
            return

        source_index = self.assignment_proxy.mapToSource(current)
        if not source_index.isValid():
            return

        row = source_index.row()
        if row < 0 or row >= len(self.assignment_model.rows):
            return

        residue = self.assignment_model.rows[row].get("residue")
        residue_i = parse_int(residue)

        if residue_i is not None:
            self.vis_widget.set_current_residue(residue_i)
            if self.focus_enabled:
                self.focus_residue = residue_i
                self.apply_residue_filter()

    def on_residue_picked(self, residue: int) -> None:
        residue_i = parse_int(residue)
        if residue_i is None:
            return

        self.vis_widget.set_current_residue(residue_i)

        if self.focus_enabled:
            self.focus_residue = residue_i
            self.apply_residue_filter()

        self.select_assignment_residue(residue_i)

    def select_assignment_residue(self, residue: int) -> None:
        for row in range(self.assignment_proxy.rowCount()):
            idx = self.assignment_proxy.index(row, 0)
            if parse_int(idx.data(Qt.EditRole)) == residue:
                self.assignment_table.selectRow(row)
                return

    def apply_residue_filter(self) -> None:
        pairs = [
            (self.assignment_proxy, self.assignment_group),
            (self.parameter_proxy, self.parameter_group),
            (self.peak_proxy, self.peaks_group),
        ]

        if not self.focus_enabled or self.focus_residue is None:
            for proxy, _ in pairs:
                proxy.set_residue(None)
            for _, group in pairs:
                group.setVisible(True)
            return

        for proxy, group in pairs:
            proxy.set_residue(self.focus_residue)
            group.setVisible(proxy.rowCount() > 0)

    # ------------------------- table row operations -------------------------

    def add_assignment_row(self) -> None:
        residue = self.vis_widget.current_residue_value()
        if residue <= 0:
            residue = 1

        condition = sorted(self.conditions)[0] if self.conditions else "condition_1"

        self.assignment_model.add_row(
            {
                "residue": residue,
                "resname": "UNK",
                "atom": "CA",
                "condition": condition,
                "shift": None,
                "intensity": None,
                "integral": None,
                "ss": "coil",
                "deviation": None,
                "note": "",
            }
        )
        self.refresh_all()

    def delete_selected_assignment(self) -> None:
        indexes = self.assignment_table.selectionModel().selectedRows()
        rows = sorted(
            {self.assignment_proxy.mapToSource(idx).row() for idx in indexes},
            reverse=True,
        )
        if rows:
            self.assignment_model.remove_rows(rows)
            self.refresh_all()

    def add_parameter_row(self) -> None:
        residue = self.vis_widget.current_residue_value()
        if residue <= 0:
            residue = 1

        condition = sorted(self.conditions)[0] if self.conditions else "condition_1"

        self.parameter_model.add_row(
            {
                "residue": residue,
                "parameter": "new_parameter",
                "value": 0.0,
                "error": 0.0,
                "units": "",
                "condition": condition,
                "note": "",
            }
        )
        self.apply_residue_filter()

    def delete_selected_parameter(self) -> None:
        indexes = self.parameter_table.selectionModel().selectedRows()
        rows = sorted(
            {self.parameter_proxy.mapToSource(idx).row() for idx in indexes},
            reverse=True,
        )
        if rows:
            self.parameter_model.remove_rows(rows)
            self.apply_residue_filter()

    # ------------------------- secondary structure / deviations -------------------------

    def paint_secondary_structure(self, ss: str) -> None:
        residues = list(self.vis_widget.residue_range())
        if not residues:
            self.statusBar().showMessage(
                "Set a residue or residue range in the 3D panel before painting.",
                5000,
            )
            return

        residues_set = set(residues)

        self.assignment_model.beginResetModel()

        existing = {
            parse_int(row.get("residue"))
            for row in self.assignment_model.rows
        }

        for row in self.assignment_model.rows:
            if parse_int(row.get("residue")) in residues_set:
                row["ss"] = ss

        missing = [r for r in residues if r not in existing]
        for res in missing:
            self.assignment_model.rows.append(
                {
                    "residue": res,
                    "resname": "UNK",
                    "atom": "CA",
                    "condition": "painted",
                    "shift": None,
                    "intensity": None,
                    "integral": None,
                    "ss": ss,
                    "deviation": expected_deviation("CA", ss),
                    "note": "painted residue",
                }
            )
            self.conditions.add("painted")

        self.assignment_model.endResetModel()

        self.recalculate_deviations()

        self.statusBar().showMessage(
            f"Painted {ss} for residues {residues[0]}-{residues[-1]}",
            4000,
        )

    def recalculate_deviations(self) -> None:
        force = bool(self.force_ss_check.isChecked())

        self.assignment_model.beginResetModel()

        for row in self.assignment_model.rows:
            row["deviation"] = compute_deviation(
                row.get("shift"),
                row.get("atom"),
                row.get("ss") or "coil",
                force=force,
            )

        self.assignment_model.endResetModel()

        self.refresh_csi()
        self.refresh_vis_ss()
        self.apply_residue_filter()

    def refresh_vis_ss(self) -> None:
        ss_map: Dict[int, str] = {}

        for row in self.assignment_model.rows:
            residue = parse_int(row.get("residue"))
            ss = row.get("ss")
            if residue is not None and ss:
                ss_map[residue] = str(ss)

        self.vis_widget.update_secondary_structure(ss_map)

    def refresh_csi(self) -> None:
        by_residue: Dict[int, List[float]] = {}

        for row in self.assignment_model.rows:
            residue = parse_int(row.get("residue"))
            deviation = parse_float(row.get("deviation"))

            if residue is None or deviation is None:
                continue

            by_residue.setdefault(residue, []).append(deviation)

        data = []
        for residue in sorted(by_residue.keys()):
            values = by_residue[residue]
            if not values:
                continue
            data.append(
                {
                    "residue": residue,
                    "value": float(np.mean(values)),
                }
            )

        self.csi_widget.set_data(data)
        self.fit_widget.set_fit_data(
            [d["residue"] for d in data],
            [d["value"] for d in data],
        )

    def refresh_all(self) -> None:
        self.recalculate_deviations()

    # ------------------------- project save/load -------------------------

    def collect_project(self) -> Dict[str, Any]:
        return {
            "version": 1,
            "pdb_filename": self.pdb_filename,
            "pdb_text": self.pdb_text,
            "conditions": sorted(self.conditions),
            "assignment_rows": self.assignment_model.rows,
            "parameter_rows": self.parameter_model.rows,
            "peak_rows": self.peak_model.rows,
            "csi_options": asdict(self.csi_widget.get_options()),
            "fit_options": asdict(self.fit_widget.get_options()),
            "fit_results": self.fit_widget.get_results(),
            "force_ss": bool(self.force_ss_check.isChecked()),
        }

    def apply_project(self, data: Dict[str, Any]) -> None:
        self.new_project()

        self.pdb_filename = str(data.get("pdb_filename", "") or "")
        self.pdb_text = str(data.get("pdb_text", "") or "")

        self.conditions = set(data.get("conditions", ["condition_1"]))
        if not self.conditions:
            self.conditions = {"condition_1"}

        self.assignment_model.set_rows(
            sanitize_rows(
                data.get("assignment_rows", []),
                AssignmentTableModel.KEYS,
                AssignmentTableModel.INT_KEYS,
                AssignmentTableModel.NUMERIC_KEYS,
            )
        )

        self.parameter_model.set_rows(
            sanitize_rows(
                data.get("parameter_rows", []),
                ParameterTableModel.KEYS,
                ParameterTableModel.INT_KEYS,
                ParameterTableModel.NUMERIC_KEYS,
            )
        )

        self.peak_model.set_rows(
            sanitize_rows(
                data.get("peak_rows", []),
                PeakTableModel.KEYS,
                PeakTableModel.INT_KEYS,
                PeakTableModel.NUMERIC_KEYS,
            )
        )

        self.csi_widget.set_options(
            options_from_dict(CSIOptions, data.get("csi_options", {}))
        )
        self.fit_widget.set_options(
            options_from_dict(FitOptions, data.get("fit_options", {}))
        )
        self.fit_widget.set_results(data.get("fit_results", []))

        self.force_ss_check.setChecked(bool(data.get("force_ss", True)))

        self.vis_widget.load_pdb_text(self.pdb_text)

        self.recalculate_deviations()
        self.apply_residue_filter()

        if self.pdb_filename:
            self.setWindowTitle(f"NMR dataset - {os.path.basename(self.pdb_filename)}")
        else:
            self.setWindowTitle("NMR assignment / CSI / fitting dataset")

    def new_project(self) -> None:
        self.pdb_text = ""
        self.pdb_filename = ""
        self.conditions = {"condition_1"}
        self.focus_enabled = False
        self.focus_residue = None

        self.assignment_model.clear()
        self.parameter_model.clear()
        self.peak_model.clear()

        self.vis_widget.load_pdb_text("")
        self.vis_widget.set_current_residue(0)
        self.vis_widget.set_focus_checked(False)

        self.btn_filter_peaks.setChecked(False)

        self.force_ss_check.setChecked(True)

        self.csi_widget.set_data([])
        self.fit_widget.set_results([])
        self.fit_widget.set_fit_data([], [])

        self.apply_residue_filter()
        self.setWindowTitle("NMR assignment / CSI / fitting dataset")

    def save_project(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save dataset",
            "dataset.json",
            "JSON dataset (*.json)",
        )
        if not path:
            return

        if not path.lower().endswith(".json"):
            path += ".json"

        data = self.collect_project()

        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, default=str)
        except Exception as exc:
            QMessageBox.warning(self, "Save error", str(exc))
            return

        self.statusBar().showMessage(f"Saved dataset to {path}", 5000)

    def open_project(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Open dataset",
            "",
            "JSON dataset (*.json);;All files (*)",
        )
        if not path:
            return

        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:
            QMessageBox.warning(self, "Open error", str(exc))
            return

        self.apply_project(data)
        self.statusBar().showMessage(f"Opened dataset from {path}", 5000)

    # ------------------------- import PDB / Sparky -------------------------

    def import_pdb(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Open PDB file",
            "",
            "PDB files (*.pdb *.ent *.txt);;All files (*)",
        )
        if not path:
            return

        try:
            with open(path, "r", errors="replace") as fh:
                text = fh.read()
        except Exception as exc:
            QMessageBox.warning(self, "PDB read error", str(exc))
            return

        self.pdb_filename = os.path.basename(path)
        self.pdb_text = text

        self.vis_widget.load_pdb_text(text)
        self.statusBar().showMessage(f"Loaded PDB: {self.pdb_filename}", 5000)

    def import_sparky(self) -> None:
        dlg = SparkyImportDialog(sorted(self.conditions), self)
        if not dlg.exec():
            return

        opts = dlg.get_result()
        path = opts.get("path", "")

        if not path or not os.path.exists(path):
            QMessageBox.warning(self, "Import error", "Please select a valid file.")
            return

        try:
            with open(path, "r", errors="replace") as fh:
                text = fh.read()
        except Exception as exc:
            QMessageBox.warning(self, "Import error", str(exc))
            return

        header, records = parse_sparky_table(text)
        if not records:
            QMessageBox.warning(self, "Import error", "No parsable records found.")
            return

        condition = str(opts.get("condition") or "imported")
        self.conditions.add(condition)

        shift_cols: List[Tuple[int, str]] = []

        if opts.get("auto_shifts", True):
            shift_cols = detect_shift_columns(header)

        if not shift_cols:
            shift_col = int(opts.get("shift_col", -1))
            if 0 <= shift_col < len(header):
                atom = atom_from_header(header[shift_col]) or "SHIFT"
                shift_cols = [(shift_col, atom)]

        imported_records = 0

        for rec in records:
            residue = None

            res_col = int(opts.get("res_col", -1))
            if 0 <= res_col < len(rec):
                residue = parse_int(rec[res_col])
                if residue is None:
                    residue = extract_residue_number(rec[res_col])

            if residue is None:
                for value in rec:
                    residue = extract_residue_from_assignment_like(value)
                    if residue is not None:
                        break

            if residue is None:
                continue

            atom = ""
            atom_col = int(opts.get("atom_col", -1))
            if 0 <= atom_col < len(rec):
                atom = guess_atom_from_text(rec[atom_col])

            intensity = None
            intensity_col = int(opts.get("intensity_col", -1))
            if 0 <= intensity_col < len(rec):
                intensity = parse_float(rec[intensity_col])

            integral = None
            integral_col = int(opts.get("integral_col", -1))
            if 0 <= integral_col < len(rec):
                integral = parse_float(rec[integral_col])

            assignment_label = f"{residue}{atom}" if atom else str(residue)

            if opts.get("import_peaks", True):
                peak_row = {
                    "peak_id": self.peak_model.rowCount() + 1,
                    "condition": condition,
                    "assignment": assignment_label,
                    "residue": residue,
                    "atom": atom,
                    "wh": None,
                    "wn": None,
                    "height": intensity,
                    "volume": integral,
                }

                for col, shift_atom in shift_cols:
                    if col < len(rec):
                        value = parse_float(rec[col])
                        if shift_atom == "H":
                            peak_row["wh"] = value
                        elif shift_atom == "N":
                            peak_row["wn"] = value

                self.peak_model.add_row(peak_row)

            if opts.get("update_assignment", True):
                if shift_cols:
                    for col, shift_atom in shift_cols:
                        shift_value = parse_float(rec[col]) if col < len(rec) else None
                        use_atom = shift_atom if shift_atom != "SHIFT" else (atom or "CA")

                        self.assignment_model.update_or_add(
                            residue=residue,
                            atom=use_atom,
                            condition=condition,
                            shift=shift_value,
                            intensity=intensity,
                            integral=integral,
                        )
                else:
                    use_atom = atom or "CA"
                    self.assignment_model.update_or_add(
                        residue=residue,
                        atom=use_atom,
                        condition=condition,
                        shift=None,
                        intensity=intensity,
                        integral=integral,
                    )

            imported_records += 1

        self.recalculate_deviations()
        self.apply_residue_filter()

        QMessageBox.information(
            self,
            "Import complete",
            f"Imported {imported_records} records into condition '{condition}'.",
        )


# ---------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------

def main() -> None:
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()