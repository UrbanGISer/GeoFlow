"""In-memory registry for non-builtin node specs."""

from __future__ import annotations

from app.models import NodeSpec

_gis_specs: list[NodeSpec] = []
_temporary_specs: list[NodeSpec] = []


def list_all_dynamic_specs() -> list[NodeSpec]:
    return [*_gis_specs, *_temporary_specs]


def list_gis_specs() -> list[NodeSpec]:
    return list(_gis_specs)


def add_gis_specs(specs: list[NodeSpec]) -> None:
    existing = {s.id for s in _gis_specs}
    for spec in specs:
        if spec.id not in existing:
            _gis_specs.append(spec)
            existing.add(spec.id)


def list_temporary_specs() -> list[NodeSpec]:
    return list(_temporary_specs)


def add_temporary_specs(specs: list[NodeSpec]) -> None:
    existing = {s.id for s in _temporary_specs}
    for spec in specs:
        if spec.id not in existing:
            _temporary_specs.append(spec)
            existing.add(spec.id)
