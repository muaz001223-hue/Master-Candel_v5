"""Disabled legacy bridge; Deriv is the only active market-data provider."""

from __future__ import annotations


def main() -> None:
    print("DERIV_STATUS=ACTIVE_PROVIDER")
    print("LEGACY_FORWARDER_STATUS=DISABLED")


if __name__ == "__main__":
    main()
