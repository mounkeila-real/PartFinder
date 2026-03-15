// Base WMI étendue pour l'Europe.
// Complète l'extraction WMI standard pour les constructeurs européens.

export const EU_WMI_EXTRA: Record<string, { manufacturer: string, country: string, city?: string }> = {
    // ── France ────────────────────────────────────────────────────────────────
    "VF1": { manufacturer: "Renault", country: "France", city: "Flins / Douai" },
    "VF2": { manufacturer: "Renault", country: "France" },
    "VF3": { manufacturer: "Peugeot", country: "France", city: "Mulhouse / Sochaux" },
    "VF7": { manufacturer: "Citroën", country: "France", city: "Rennes / Aulnay" },
    "VF6": { manufacturer: "Citroën", country: "France" },
    "VF8": { manufacturer: "Matra", country: "France" },
    "VFA": { manufacturer: "Renault Sport", country: "France" },
    "VFE": { manufacturer: "Alpine", country: "France" },
    "VF0": { manufacturer: "Ligier", country: "France" },
    "VF5": { manufacturer: "Microcar", country: "France" },

    // ── Allemagne ─────────────────────────────────────────────────────────────
    "WBA": { manufacturer: "BMW", country: "Allemagne", city: "Munich" },
    "WBS": { manufacturer: "BMW M", country: "Allemagne", city: "Munich" },
    "WBY": { manufacturer: "BMW i / MINI EV", country: "Allemagne" },
    "WDB": { manufacturer: "Mercedes-Benz", country: "Allemagne", city: "Stuttgart" },
    "WDC": { manufacturer: "Mercedes-Benz SUV", country: "Allemagne" },
    "WDD": { manufacturer: "Mercedes-Benz", country: "Allemagne" },
    "WDF": { manufacturer: "Mercedes-Benz Vans", country: "Allemagne" },
    "WDH": { manufacturer: "Daimler Trucks", country: "Allemagne" },
    "WMW": { manufacturer: "MINI", country: "Allemagne", city: "Oxford / Munich" },
    "WP0": { manufacturer: "Porsche", country: "Allemagne", city: "Stuttgart-Zuffenhausen" },
    "WP1": { manufacturer: "Porsche SUV (Cayenne/Macan)", country: "Allemagne" },
    "WUA": { manufacturer: "Audi Sport (RS)", country: "Allemagne", city: "Neckarsulm" },
    "WVW": { manufacturer: "Volkswagen", country: "Allemagne", city: "Wolfsburg" },
    "WV1": { manufacturer: "Volkswagen Commercial", country: "Allemagne" },
    "WV2": { manufacturer: "Volkswagen Bus / Transporter", country: "Allemagne" },
    "WV3": { manufacturer: "Volkswagen Trucks", country: "Allemagne" },
    "WAU": { manufacturer: "Audi", country: "Allemagne", city: "Ingolstadt / Neckarsulm" },
    "WA1": { manufacturer: "Audi SUV", country: "Allemagne" },
    "VSS": { manufacturer: "SEAT", country: "Espagne", city: "Martorell" },
    "VSK": { manufacturer: "SEAT Marbella", country: "Espagne" },

    // ── Italie ────────────────────────────────────────────────────────────────
    "ZAR": { manufacturer: "Alfa Romeo", country: "Italie" },
    "ZAM": { manufacturer: "Maserati", country: "Italie", city: "Modène" },
    "ZCF": { manufacturer: "Iveco", country: "Italie" },
    "ZFF": { manufacturer: "Ferrari", country: "Italie", city: "Maranello" },
    "ZHW": { manufacturer: "Lamborghini", country: "Italie", city: "Sant'Agata Bolognese" },
    "ZLA": { manufacturer: "Lancia", country: "Italie" },
    "ZFA": { manufacturer: "Fiat", country: "Italie", city: "Turin / Melfi" },
    "ZFB": { manufacturer: "Fiat Bravo", country: "Italie" },
    "ZFC": { manufacturer: "Fiat Stilo", country: "Italie" },
    "ZGU": { manufacturer: "De Tomaso", country: "Italie" },
    "ZAA": { manufacturer: "Abarth", country: "Italie" },

    // ── Royaume-Uni ───────────────────────────────────────────────────────────
    "SAJ": { manufacturer: "Jaguar", country: "Royaume-Uni", city: "Castle Bromwich" },
    "SAL": { manufacturer: "Land Rover / Range Rover", country: "Royaume-Uni", city: "Solihull" },
    "SAR": { manufacturer: "Rover", country: "Royaume-Uni" },
    "SCB": { manufacturer: "Bentley", country: "Royaume-Uni", city: "Crewe" },
    "SCC": { manufacturer: "Lotus", country: "Royaume-Uni" },
    "SDB": { manufacturer: "Aston Martin", country: "Royaume-Uni", city: "Gaydon" },
    "SED": { manufacturer: "General Motors UK (Vauxhall)", country: "Royaume-Uni" },
    "SFA": { manufacturer: "Ford UK", country: "Royaume-Uni" },
    "SHH": { manufacturer: "Honda UK", country: "Royaume-Uni" },

    // ── Suède ─────────────────────────────────────────────────────────────────
    "YV1": { manufacturer: "Volvo Cars", country: "Suède", city: "Göteborg / Torslanda" },
    "YV2": { manufacturer: "Volvo Trucks", country: "Suède" },
    "YS2": { manufacturer: "Scania", country: "Suède" },
    "YS3": { manufacturer: "Saab", country: "Suède" },

    // ── Pays-Bas ──────────────────────────────────────────────────────────────
    "XLR": { manufacturer: "DAF / Leyland", country: "Pays-Bas" },
    "XLE": { manufacturer: "Spyker", country: "Pays-Bas" },

    // ── Espagne ───────────────────────────────────────────────────────────────
    "VNK": { manufacturer: "Toyota España", country: "Espagne" },
    "VN1": { manufacturer: "Nissan España", country: "Espagne" },
    "VS6": { manufacturer: "Ford España", country: "Espagne" },
    "VSX": { manufacturer: "Volkswagen España (Audi)", country: "Espagne", city: "Pamplona" },

    // ── Roumanie / Tchéquie / Pologne ─────────────────────────────────────────
    "UU1": { manufacturer: "Dacia", country: "Roumanie", city: "Mioveni" },
    "UU3": { manufacturer: "Dacia", country: "Roumanie" },
    "TMB": { manufacturer: "Škoda", country: "République tchèque", city: "Mladá Boleslav" },
    "TMA": { manufacturer: "Škoda", country: "République tchèque" },
    "SUF": { manufacturer: "FSO / Opel Polonia", country: "Pologne" },

    // ── Hongrie / Slovénie ────────────────────────────────────────────────────
    "TRU": { manufacturer: "Audi Hungaria", country: "Hongrie", city: "Győr" },

    // ── Belgique ──────────────────────────────────────────────────────────────
    "YV4": { manufacturer: "Volvo Cars Belgique (Gand)", country: "Belgique" },

    // ── Russie ────────────────────────────────────────────────────────────────
    "XTA": { manufacturer: "AvtoVAZ (Lada)", country: "Russie", city: "Togliatti" },
    "XTT": { manufacturer: "GAZ", country: "Russie" },
    "XUF": { manufacturer: "UAZ", country: "Russie" }
};
