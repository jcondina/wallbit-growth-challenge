/**
 * What the user copies to make the transfer from their bank / wallet.
 * Sandbox values only — zero patterns and .example addresses that could
 * never be mistaken for a real account. The field *name* (not the value)
 * is what funding_details_copied records.
 */

export interface InstructionField {
  name: string;
  label: string;
  value: string;
}

export interface Instructions {
  /** One line telling the user what to do outside the app. */
  howTo: string;
  fields: InstructionField[];
}

const REFERENCE = (userId: string): InstructionField => ({
  name: "reference",
  label: "Referencia (obligatoria)",
  value: userId.toUpperCase(),
});

const BY_METHOD: Record<string, (userId: string) => Instructions> = {
  local_ar: (u) => ({
    howTo: "Hacé una transferencia en pesos desde tu home banking a esta cuenta. Se convierte a dólares al acreditarse.",
    fields: [
      { name: "cbu", label: "CBU", value: "0000000000000000000000" },
      { name: "alias", label: "Alias", value: "WALLBIT.SANDBOX.ARS" },
      { name: "holder", label: "Titular", value: "Wallbit Sandbox S.A." },
      REFERENCE(u),
    ],
  }),
  local_mx: (u) => ({
    howTo: "Envía un SPEI desde tu banco a esta CLABE. Se convierte a dólares al acreditarse.",
    fields: [
      { name: "clabe", label: "CLABE", value: "000000000000000000" },
      { name: "holder", label: "Beneficiario", value: "Wallbit Sandbox S.A. de C.V." },
      REFERENCE(u),
    ],
  }),
  local_co: (u) => ({
    howTo: "Pagá por PSE desde tu banco a esta cuenta. Se convierte a dólares al acreditarse.",
    fields: [
      { name: "account", label: "Cuenta de ahorros", value: "0000-0000-0000" },
      { name: "holder", label: "Titular", value: "Wallbit Sandbox S.A.S." },
      REFERENCE(u),
    ],
  }),
  local_br: (u) => ({
    howTo: "Faça um PIX para esta chave. Convertemos para dólares na compensação.",
    fields: [
      { name: "pix_key", label: "Chave PIX", value: "sandbox@wallbit.example" },
      { name: "holder", label: "Favorecido", value: "Wallbit Sandbox Ltda." },
      REFERENCE(u),
    ],
  }),
  sepa_eu: (u) => ({
    howTo: "Hacé una transferencia SEPA desde tu banco a esta cuenta en euros.",
    fields: [
      { name: "iban", label: "IBAN", value: "ES00 0000 0000 0000 0000 0000" },
      { name: "bic", label: "BIC", value: "WBITESXX" },
      { name: "holder", label: "Titular", value: "Wallbit Sandbox S.L." },
      REFERENCE(u),
    ],
  }),
  ach_us: (u) => ({
    howTo: "Envía un ACH desde tu banco en EE.UU. a esta cuenta.",
    fields: [
      { name: "routing", label: "Routing number", value: "000000000" },
      { name: "account", label: "Account number", value: "0000000000" },
      { name: "holder", label: "Beneficiary", value: "Wallbit Sandbox Inc." },
      REFERENCE(u),
    ],
  }),
  wire_us: (u) => ({
    howTo: "Hacé una transferencia internacional (wire) en dólares a esta cuenta.",
    fields: [
      { name: "swift", label: "SWIFT / BIC", value: "WBITUS00" },
      { name: "account", label: "Account number", value: "0000000000" },
      { name: "routing", label: "Routing number", value: "000000000" },
      { name: "holder", label: "Beneficiary", value: "Wallbit Sandbox Inc." },
      REFERENCE(u),
    ],
  }),
  crypto_usdt: (u) => ({
    howTo: "Enviá USDT a esta dirección desde tu wallet o exchange. Elegí la red correcta antes de enviar.",
    fields: [
      { name: "network", label: "Redes", value: "Ethereum · Tron · Polygon · BSC" },
      { name: "address", label: "Dirección", value: "0x0000000000000000000000000000000000000000" },
      REFERENCE(u),
    ],
  }),
  crypto_usdc: (u) => ({
    howTo: "Enviá USDC a esta dirección desde tu wallet o exchange. Elegí la red correcta antes de enviar.",
    fields: [
      { name: "network", label: "Redes", value: "Ethereum · Tron · Polygon · Base" },
      { name: "address", label: "Dirección", value: "0x0000000000000000000000000000000000000000" },
      REFERENCE(u),
    ],
  }),
};

const THIRD_PARTY = (label: string) => (u: string): Instructions => ({
  howTo: `Enviá dólares desde tu cuenta de ${label} a este destinatario.`,
  fields: [
    { name: "email", label: `Cuenta de ${label}`, value: "sandbox@wallbit.example" },
    REFERENCE(u),
  ],
});

BY_METHOD.paypal = THIRD_PARTY("PayPal");
BY_METHOD.wise = THIRD_PARTY("Wise");
BY_METHOD.payoneer = THIRD_PARTY("Payoneer");

const LOCAL_GENERIC = (country: string) => (u: string): Instructions => ({
  howTo: `Hacé una transferencia local desde tu banco en ${country} a esta cuenta.`,
  fields: [
    { name: "account", label: "Cuenta", value: "0000-0000-0000-0000" },
    { name: "holder", label: "Titular", value: "Wallbit Sandbox" },
    REFERENCE(u),
  ],
});

BY_METHOD.local_pe = LOCAL_GENERIC("Perú");
BY_METHOD.local_bo = LOCAL_GENERIC("Bolivia");
BY_METHOD.local_gt = LOCAL_GENERIC("Guatemala");
BY_METHOD.local_do = LOCAL_GENERIC("República Dominicana");

export function instructionsFor(methodId: string, userId: string): Instructions {
  const build = BY_METHOD[methodId];
  if (build) return build(userId);
  return {
    howTo: "Usá estos datos para transferir desde tu banco o plataforma.",
    fields: [{ name: "account", label: "Cuenta", value: "0000-0000-0000" }, REFERENCE(userId)],
  };
}
