import * as crypto from "crypto";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; 
const SEPARADOR = ":";

export class CriptografiaArquivo {
  gerarChave(): string {
    return crypto.randomBytes(32).toString("hex"); 
  }

  cifrar(dados: string, chave: string): string {
    const chaveBuffer = Buffer.from(chave, "hex");
    const iv = crypto.randomBytes(TAMANHO_IV);
    const cipher = crypto.createCipheriv(ALGORITMO, chaveBuffer, iv, authTagLength: 16 );

    const cifrado = Buffer.concat([cipher.update(dados, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString("hex"), authTag.toString("hex"), cifrado.toString("hex")].join(SEPARADOR);
  }

  decifrar(dadosCifrados: string, chave: string): string {
    const [ivHex, authTagHex, cifradoHex] = dadosCifrados.split(SEPARADOR);

    const chaveBuffer = Buffer.from(chave, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITMO, chaveBuffer, iv, authTagLength: 16 );
    decipher.setAuthTag(authTag);

    const decifrado = Buffer.concat([
      decipher.update(Buffer.from(cifradoHex, "hex")),
      decipher.final(),
    ]);
    return decifrado.toString("utf8");
  }
}