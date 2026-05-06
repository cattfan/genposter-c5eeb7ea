const version = process.versions.node;
const [major, minor, patch] = version.split(".").map(Number);

const isNode20Lts = major === 20 && (minor > 19 || (minor === 19 && patch >= 0));
const isNode22Lts = major === 22 && (minor > 12 || (minor === 12 && patch >= 0));
const isNewer = major > 22;

if (!isNode20Lts && !isNode22Lts && !isNewer) {
  console.error("");
  console.error(`Node.js ${version} khong phu hop voi GenPoster.`);
  console.error("Can Node.js 20.19+ hoac 22.12+.");
  console.error("Tai ban LTS moi tai https://nodejs.org/ roi chay lai setup.bat.");
  console.error("");
  process.exit(1);
}

console.log(`Node.js ${version} OK.`);
