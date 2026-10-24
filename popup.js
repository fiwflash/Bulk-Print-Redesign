let senderImageData = null; 
let receiverImageData = null; 
let combinedImageData = null; 
let reviewAddReceiverImageData = null;
let receiverList = [];
let activeTab = 'separate';
let historyExpanded = false;

const HISTORY_COLLAPSED_LIMIT = 3;
const MAX_SCAN_HISTORY = 50;
const MAX_SAVED_SENDERS = 50;
const MAX_SAVED_RECEIVERS = 500;

// ==========================================
// 🗺️ DATABASE LOADING (จาก Gist)
// ==========================================
const DATABASE_URL = 'https://gist.githubusercontent.com/fiwflash/7d2dc9d1ffbe8e0b8d89430668289a62/raw/database.json';
const OVERLAP_DB_URL = 'https://gist.githubusercontent.com/fiwflash/cc0795e30e0072a0e60e68870a3cb7ad/raw/0aeb1a5d210b27d60432b871d6f2c0667f47e8e5/overlap_cases_database.json';

let cachedProvinceData = null;
let cachedOverlapData = null;

async function initDatabases() {
    if (!cachedProvinceData) {
        try {
            const response = await fetch(DATABASE_URL);
            if (response.ok) {
                cachedProvinceData = await response.json();
                
                if (cachedProvinceData) {
                    const chiangMai = cachedProvinceData.find(p => p.name_th === "เชียงใหม่");
                    if (chiangMai) {
                        const mueangChiangMai = chiangMai.districts.find(d => d.name_th === "เมืองเชียงใหม่");
                        if (mueangChiangMai) {
                            const maeHia = mueangChiangMai.sub_districts.find(s => s.name_th === "แม่เหียะ");
                            if (!maeHia) {
                                mueangChiangMai.sub_districts.push({
                                    id: 500199,
                                    name_th: "แม่เหียะ",
                                    zip_code: "50100"
                                });
                            }
                        }
                    }
                }
                
                console.log('✅ Database loaded:', cachedProvinceData.length, 'provinces');
            }
        } catch (e) {
            console.error('❌ Failed to load database:', e);
            cachedProvinceData = [];
        }
    }

    if (!cachedOverlapData) {
        try {
            const response = await fetch(OVERLAP_DB_URL);
            if (response.ok) {
                cachedOverlapData = await response.json();
                console.log('✅ Overlap database loaded:', cachedOverlapData.length, 'zones');
            }
        } catch (e) {
            console.error('❌ Failed to load overlap database:', e);
            cachedOverlapData = [];
        }
    }
}

function getDatabase() {
    return cachedProvinceData;
}

function getOverlapDatabase() {
    return cachedOverlapData;
}

// ==========================================
// 🔍 ADDRESS VALIDATION ENGINE
// ==========================================

function preprocessAlias(text) {
    let result = text;
    const aliases = {
        "โคราช": "นครราชสีมา",
        "แปดริ้ว": "ฉะเชิงเทรา",
        "เมืองคอน": "นครศรีธรรมราช",
        "กทม\\.?": "กรุงเทพมหานคร",
        "กรุงเทพ$": "กรุงเทพมหานคร",
        "พัทยา": "หนองปรือ บางละมุง ชลบุรี",
        "เชียงมัย": "เชียงใหม่"
    };

    for (const [key, value] of Object.entries(aliases)) {
        let regex = new RegExp(key, 'g');
        result = result.replace(regex, value);
    }
    return result;
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function isProvinceInText(text, provinceName) {
    const prefixRegex = new RegExp('(จ\\.|จังหวัด|จว\\.)\\s*' + provinceName);
    if (prefixRegex.test(text)) return true;
    
    if (["เลย", "ตาก", "แพร่"].includes(provinceName)) return false;
    
    let index = text.indexOf(provinceName);
    while (index !== -1) {
        const before = text.substring(0, index).trim();
        const isDistrictOrSubDistrict = /(\b|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|เมือง)$/.test(before);
        if (!isDistrictOrSubDistrict) {
            return true;
        }
        index = text.indexOf(provinceName, index + 1);
    }
    return false;
}

function isSubDistrictInText(text, tambonName, isBKK) {
    const prefix = isBKK ? '(ต\\.|ตำบล|แขวง)' : '(ต\\.|ตำบล)';
    const prefixRegex = new RegExp(prefix + '\\s*' + tambonName);
    if (prefixRegex.test(text)) return true;
    
    let index = text.indexOf(tambonName);
    while (index !== -1) {
        const before = text.substring(0, index).trim();
        const isDistrict = /(\b|อำเภอ|อ\.|เขต)$/.test(before);
        if (!isDistrict) {
            return true;
        }
        index = text.indexOf(tambonName, index + 1);
    }
    return false;
}

function isDistrictInText(text, amphureName, isBKK) {
    let cleanName = amphureName.replace("เขต", "");
    const prefix = isBKK ? '(อ\\.|อำเภอ|เขต)' : '(อ\\.|อำเภอ)';
    const prefixRegex = new RegExp(prefix + '\\s*' + cleanName);
    if (prefixRegex.test(text)) return true;
    
    let index = text.indexOf(cleanName);
    while (index !== -1) {
        const before = text.substring(0, index).trim();
        const isSubDistrict = /(\b|ตำบล|ต\.|แขวง)$/.test(before);
        if (!isSubDistrict) {
            return true;
        }
        index = text.indexOf(cleanName, index + 1);
    }
    return false;
}

function getMatchScore(text, target, type, provinceName = null) {
    if (text === target) return 0;
    
    let cleanTarget = target.replace(/^(เขต|แขวง|อำเภอ|ตำบล|จังหวัด)/, '');
    let isBKK = provinceName === "กรุงเทพมหานคร";
    
    if (type === "T") {
        if (isSubDistrictInText(text, cleanTarget, isBKK)) return 0;
    } else if (type === "A") {
        if (isDistrictInText(text, cleanTarget, isBKK)) return 0;
    } else if (type === "P") {
        if (isProvinceInText(text, cleanTarget)) return 0;
    }
    
    if (type === "A" && cleanTarget.startsWith("เมือง")) {
        const provinces = getDatabase();
        let belongsToOtherProvince = false;
        if (provinces) {
            for (let p of provinces) {
                if (p.name_th !== provinceName) {
                    const otherPrefixRegex = new RegExp('(อ\\.?|อำเภอ)\\s*เมือง\\s*(จ\\.|จังหวัด|จว\\.)?\\s*' + p.name_th);
                    if (otherPrefixRegex.test(text)) {
                        belongsToOtherProvince = true;
                        break;
                    }
                }
            }
        }
        
        if (!belongsToOtherProvince && /(อ\.?|อำเภอ)\s*เมือง/.test(text)) {
            return 0;
        }
    }
    
    if (type === "P") {
        const provinces = getDatabase();
        if (provinces) {
            for (let p of provinces) {
                if (p.name_th !== cleanTarget && isProvinceInText(text, p.name_th)) {
                    return 1.0;
                }
            }
        }
    }

    if (text.indexOf(cleanTarget) !== -1) return 0.2;

    if (cleanTarget.length > 3) {
        let minDistance = cleanTarget.length;
        for (let i = 0; i <= text.length - cleanTarget.length + 2; i++) {
            for (let lenOffset = -2; lenOffset <= 2; lenOffset++) {
                let subLength = cleanTarget.length + lenOffset;
                if (subLength <= 2 || i + subLength > text.length) continue;
                let subStr = text.substring(i, i + subLength);
                let dist = levenshtein(subStr, cleanTarget);
                if (dist < minDistance) minDistance = dist;
            }
        }
        let allowedErrors = Math.floor(cleanTarget.length * 0.25);
        if (minDistance <= allowedErrors && minDistance > 0) {
            return 0.5;
        }
    }
    
    return 1;
}

function validateReceiverAddress(index) {
    const provinces = getDatabase();
    if (!provinces || provinces.length === 0) {
        return {
            status: 'error',
            message: '⏳ กำลังโหลดฐานข้อมูล กรุณาลองใหม่อีกครั้ง'
        };
    }

    const receiver = receiverList[index];
    if (!receiver) return null;

    const address = receiver.address || '';
    const postcode = receiver.postcode || '';
    
    if (!postcode || postcode.length !== 5) {
        if (address && address.length > 10) {
            let processedText = preprocessAlias(address);
            let suggestion = suggestAddressByText(processedText, provinces);
            
            if (suggestion && suggestion.score >= 1.5) {
                let formattedSuggestion = formatPartialAddress(suggestion, processedText);
                return {
                    status: 'warning',
                    message: `⚠️ ไม่พบรหัสไปรษณีย์ในข้อมูล\n\n✨ จากที่อยู่ที่ระบุ ระบบแนะนำ:\n📮 ${formattedSuggestion}\n\n💡 โปรดตรวจสอบและกรอกรหัสไปรษณีย์ ${suggestion.zip_code} ด้วยตนเอง`
                };
            }
        }
        
        return {
            status: 'error',
            message: '⚠️ ไม่พบรหัสไปรษณีย์ 5 หลักในข้อมูลนี้\n💡 โปรดระบุรหัสไปรษณีย์ 5 หลักให้ครบถ้วน'
        };
    }

    let processedText = preprocessAlias(address);
    
    let possibleMatches = [];
    for (let p of provinces) {
        for (let d of p.districts) {
            for (let s of d.sub_districts) {
                if (s.zip_code == postcode) {
                    possibleMatches.push({
                        tambon: s.name_th,
                        amphure: d.name_th,
                        province: p.name_th,
                        zip_code: s.zip_code
                    });
                }
            }
        }
    }

    if (possibleMatches.length === 0) {
        let suggestion = suggestAddressByText(processedText, provinces);
        if (suggestion && suggestion.score >= 1.5) {
            return {
                status: 'wrong',
                message: `❌ ไม่พบรหัสไปรษณีย์ ${postcode} ในฐานข้อมูล\n\n✨ จากข้อมูลที่อยู่ ระบบแนะนำ:\n📮 ${formatPartialAddress(suggestion, processedText)}\n💡 กรุณาตรวจสอบและแก้ไขรหัสไปรษณีย์ด้วยตนเอง`
            };
        }
        return {
            status: 'error',
            message: `❌ ไม่พบรหัสไปรษณีย์ ${postcode} ในฐานข้อมูล\n💡 กรุณาตรวจสอบความถูกต้องอีกครั้ง`
        };
    }

    let bestMatch = null;
    let minErrors = 999;
    let bestErrorsList = [];

    for (let match of possibleMatches) {
        let currentErrors = [];
        let errCount = 0;
        
        let isBKK = match.province === "กรุงเทพมหานคร";
        let prefixT = isBKK ? "แขวง" : "ตำบล";
        let prefixA = isBKK ? "เขต" : "อำเภอ";
        
        let tScore = getMatchScore(processedText, match.tambon, "T", match.province);
        if (tScore === 0.5) {
            currentErrors.push(`${prefixT}: "${match.tambon}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (tScore === 1) {
            currentErrors.push(`${prefixT}: "${match.tambon}" (ไม่พบในที่อยู่)`);
            errCount += 0.3;
        }
        
        let cleanAmphure = match.amphure.replace("เขต", "");
        let aScore = getMatchScore(processedText, cleanAmphure, "A", match.province);
        if (aScore === 0.5) {
            currentErrors.push(`${prefixA}: "${cleanAmphure}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (aScore === 1) {
            let foundOtherDistrict = null;
            let foundOtherProvince = null;
            if (provinces) {
                for (let prov of provinces) {
                    for (let dist of prov.districts) {
                        let cleanDist = dist.name_th.replace("เขต", "");
                        let distRegex = new RegExp('(อ\\.|อำเภอ|เขต)\\s*' + cleanDist);
                        if (cleanDist !== cleanAmphure && distRegex.test(processedText)) {
                            foundOtherDistrict = dist.name_th;
                            foundOtherProvince = prov.name_th;
                            break;
                        }
                    }
                    if (foundOtherDistrict) break;
                }
            }
            if (foundOtherDistrict) {
                currentErrors.push(`${prefixA}: "${match.amphure}" (ไม่พบในที่อยู่ แต่พบ "${foundOtherDistrict}" ซึ่งอยู่ในจังหวัด${foundOtherProvince})`);
            } else {
                currentErrors.push(`${prefixA}: "${cleanAmphure}" (ไม่พบในที่อยู่)`);
            }
            errCount += 0.6;
        }

        let pScore = getMatchScore(processedText, match.province, "P", match.province);
        if (pScore === 0.5) {
            currentErrors.push(`จังหวัด: "${match.province}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (pScore === 1) {
            let foundOtherProvince = null;
            if (provinces) {
                for (let prov of provinces) {
                    if (prov.name_th !== match.province && isProvinceInText(processedText, prov.name_th)) {
                        foundOtherProvince = prov.name_th;
                        break;
                    }
                }
            }
            if (foundOtherProvince) {
                currentErrors.push(`จังหวัด: "${match.province}" (ไม่พบในที่อยู่ แต่พบ "${foundOtherProvince}")`);
            } else {
                currentErrors.push(`จังหวัด: "${match.province}" (ไม่พบในที่อยู่)`);
            }
            errCount += 0.6;
        }

        if (errCount < minErrors) {
            minErrors = errCount;
            bestErrorsList = currentErrors;
            bestMatch = match;
        }
        if (minErrors === 0) break;
    }

    let formattedAddress = formatPartialAddress(bestMatch, processedText);

    const overlappingAreas = getOverlapDatabase();
    let overlapWarning = '';
    if (overlappingAreas && overlappingAreas.length > 0) {
        const overlapMatch = overlappingAreas.find(area => area.zip_code === String(postcode));
        if (overlapMatch && overlapMatch.warningMessage) {
            overlapWarning = '\n\n⚠️ ' + overlapMatch.warningMessage;
        }
    }

    if (minErrors === 0) {
        return {
            status: 'correct',
            message: `✅ ถูกต้อง\n📮 ${formattedAddress}${overlapWarning}`
        };
    } else if (minErrors < 0.5) {
        return {
            status: 'warning',
            message: `⚠️ พบจุดที่ควรตรวจสอบ:\n• ${bestErrorsList.join('\n• ')}\n\n📮 รูปแบบที่ถูกต้อง:\n${formattedAddress}${overlapWarning}\n\n💡 กรุณาตรวจสอบและแก้ไขด้วยตนเอง`
        };
    } else {
        let suggestion = suggestAddressByText(processedText, provinces);
        let suggestedMsg = '';
        
        if (suggestion && suggestion.zip_code !== postcode && suggestion.score >= 1.5) {
            suggestedMsg = `\n\n✨ จากชื่อตำบล/อำเภอในที่อยู่ ระบบแนะนำ:\n📮 ${formatPartialAddress(suggestion, processedText)}\n💡 รหัสไปรษณีย์ที่ถูกต้องควรเป็น ${suggestion.zip_code}`;
        }
        
        return {
            status: 'wrong',
            message: `❌ ข้อมูลไม่สอดคล้องกับรหัสไปรษณีย์ ${postcode}\n\n• ${bestErrorsList.join('\n• ')}\n\n📮 จากรหัสไปรษณีย์นี้ ควรเป็น:\n${formattedAddress}${overlapWarning}${suggestedMsg}\n\n💡 กรุณาตรวจสอบและแก้ไขด้วยตนเอง`
        };
    }
}

function validateSenderAddress() {
    const provinces = getDatabase();
    if (!provinces || provinces.length === 0) {
        return {
            status: 'error',
            message: '⏳ กำลังโหลดฐานข้อมูล กรุณาลองใหม่อีกครั้ง'
        };
    }

    const address = document.getElementById('rev_saddress')?.value || '';
    const postcode = document.getElementById('rev_spostcode')?.value || '';
    
    if (!postcode || postcode.length !== 5) {
        if (address && address.length > 10) {
            let processedText = preprocessAlias(address);
            let suggestion = suggestAddressByText(processedText, provinces);
            
            if (suggestion && suggestion.score >= 1.5) {
                let formattedSuggestion = formatPartialAddress(suggestion, processedText);
                return {
                    status: 'warning',
                    message: `⚠️ ไม่พบรหัสไปรษณีย์ผู้ส่ง\n\n✨ จากที่อยู่ที่ระบุ ระบบแนะนำ:\n📮 ${formattedSuggestion}\n\n💡 โปรดตรวจสอบและกรอกรหัสไปรษณีย์ ${suggestion.zip_code} ด้วยตนเอง`
                };
            }
        }
        
        return {
            status: 'error',
            message: '⚠️ ไม่พบรหัสไปรษณีย์ผู้ส่ง 5 หลัก\n💡 โปรดระบุรหัสไปรษณีย์ 5 หลักให้ครบถ้วน'
        };
    }

    let processedText = preprocessAlias(address);
    
    let possibleMatches = [];
    for (let p of provinces) {
        for (let d of p.districts) {
            for (let s of d.sub_districts) {
                if (s.zip_code == postcode) {
                    possibleMatches.push({
                        tambon: s.name_th,
                        amphure: d.name_th,
                        province: p.name_th,
                        zip_code: s.zip_code
                    });
                }
            }
        }
    }

    if (possibleMatches.length === 0) {
        let suggestion = suggestAddressByText(processedText, provinces);
        if (suggestion && suggestion.score >= 1.5) {
            return {
                status: 'wrong',
                message: `❌ ไม่พบรหัสไปรษณีย์ ${postcode} ในฐานข้อมูล\n\n✨ จากข้อมูลที่อยู่ ระบบแนะนำ:\n📮 ${formatPartialAddress(suggestion, processedText)}\n💡 กรุณาตรวจสอบและแก้ไขรหัสไปรษณีย์ด้วยตนเอง`
            };
        }
        return {
            status: 'error',
            message: `❌ ไม่พบรหัสไปรษณีย์ ${postcode} ในฐานข้อมูล\n💡 กรุณาตรวจสอบความถูกต้องอีกครั้ง`
        };
    }

    let bestMatch = null;
    let minErrors = 999;
    let bestErrorsList = [];

    for (let match of possibleMatches) {
        let currentErrors = [];
        let errCount = 0;
        
        let isBKK = match.province === "กรุงเทพมหานคร";
        let prefixT = isBKK ? "แขวง" : "ตำบล";
        let prefixA = isBKK ? "เขต" : "อำเภอ";
        
        let tScore = getMatchScore(processedText, match.tambon, "T", match.province);
        if (tScore === 0.5) {
            currentErrors.push(`${prefixT}: "${match.tambon}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (tScore === 1) {
            currentErrors.push(`${prefixT}: "${match.tambon}" (ไม่พบในที่อยู่)`);
            errCount += 0.3;
        }
        
        let cleanAmphure = match.amphure.replace("เขต", "");
        let aScore = getMatchScore(processedText, cleanAmphure, "A", match.province);
        if (aScore === 0.5) {
            currentErrors.push(`${prefixA}: "${cleanAmphure}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (aScore === 1) {
            let foundOtherDistrict = null;
            let foundOtherProvince = null;
            if (provinces) {
                for (let prov of provinces) {
                    for (let dist of prov.districts) {
                        let cleanDist = dist.name_th.replace("เขต", "");
                        let distRegex = new RegExp('(อ\\.|อำเภอ|เขต)\\s*' + cleanDist);
                        if (cleanDist !== cleanAmphure && distRegex.test(processedText)) {
                            foundOtherDistrict = dist.name_th;
                            foundOtherProvince = prov.name_th;
                            break;
                        }
                    }
                    if (foundOtherDistrict) break;
                }
            }
            if (foundOtherDistrict) {
                currentErrors.push(`${prefixA}: "${match.amphure}" (ไม่พบในที่อยู่ แต่พบ "${foundOtherDistrict}" ซึ่งอยู่ในจังหวัด${foundOtherProvince})`);
            } else {
                currentErrors.push(`${prefixA}: "${cleanAmphure}" (ไม่พบในที่อยู่)`);
            }
            errCount += 0.6;
        }

        let pScore = getMatchScore(processedText, match.province, "P", match.province);
        if (pScore === 0.5) {
            currentErrors.push(`จังหวัด: "${match.province}" (อาจสะกดผิด)`);
            errCount += 0.5;
        } else if (pScore === 1) {
            let foundOtherProvince = null;
            if (provinces) {
                for (let prov of provinces) {
                    if (prov.name_th !== match.province && isProvinceInText(processedText, prov.name_th)) {
                        foundOtherProvince = prov.name_th;
                        break;
                    }
                }
            }
            if (foundOtherProvince) {
                currentErrors.push(`จังหวัด: "${match.province}" (ไม่พบในที่อยู่ แต่พบ "${foundOtherProvince}")`);
            } else {
                currentErrors.push(`จังหวัด: "${match.province}" (ไม่พบในที่อยู่)`);
            }
            errCount += 0.6;
        }

        if (errCount < minErrors) {
            minErrors = errCount;
            bestErrorsList = currentErrors;
            bestMatch = match;
        }
        if (minErrors === 0) break;
    }

    let formattedAddress = formatPartialAddress(bestMatch, processedText);

    if (minErrors === 0) {
        return {
            status: 'correct',
            message: `✅ รหัสไปรษณีย์ผู้ส่ง ${postcode} ถูกต้อง\n📮 ${formattedAddress}`
        };
    } else if (minErrors < 0.5) {
        return {
            status: 'warning',
            message: `⚠️ พบจุดที่ควรตรวจสอบ:\n• ${bestErrorsList.join('\n• ')}\n\n📮 รูปแบบที่ถูกต้อง:\n${formattedAddress}\n\n💡 กรุณาตรวจสอบและแก้ไขด้วยตนเอง`
        };
    } else {
        let suggestion = suggestAddressByText(processedText, provinces);
        let suggestedMsg = '';
        
        if (suggestion && suggestion.zip_code !== postcode && suggestion.score >= 1.5) {
            suggestedMsg = `\n\n✨ จากชื่อตำบล/อำเภอในที่อยู่ ระบบแนะนำ:\n📮 ${formatPartialAddress(suggestion, processedText)}\n💡 รหัสไปรษณีย์ที่ถูกต้องควรเป็น ${suggestion.zip_code}`;
        }
        
        return {
            status: 'wrong',
            message: `❌ ข้อมูลผู้ส่งไม่สอดคล้องกับรหัสไปรษณีย์ ${postcode}\n\n• ${bestErrorsList.join('\n• ')}\n\n📮 จากรหัสไปรษณีย์นี้ ควรเป็น:\n${formattedAddress}${suggestedMsg}\n\n💡 กรุณาตรวจสอบและแก้ไขด้วยตนเอง`
        };
    }
}

function formatAddressData(data) {
    if (data.province === "กรุงเทพมหานคร") {
        let khet = data.amphure.replace("เขต", "");
        return `แขวง${data.tambon} เขต${khet} กรุงเทพมหานคร ${data.zip_code}`;
    } else {
        return `ต.${data.tambon} อ.${data.amphure} จ.${data.province} ${data.zip_code}`;
    }
}

function formatPartialAddress(data, text) {
    const parts = [];
    const isBKK = data.province === "กรุงเทพมหานคร";
    if (isBKK) {
        if (isSubDistrictInText(text, data.tambon, true)) {
            parts.push(`แขวง${data.tambon}`);
        }
        const khet = data.amphure.replace("เขต", "");
        if (isDistrictInText(text, khet, true)) {
            parts.push(`เขต${khet}`);
        }
        if (isProvinceInText(text, "กรุงเทพมหานคร") || text.includes("กรุงเทพ")) {
            parts.push("กรุงเทพมหานคร");
        }
    } else {
        if (isSubDistrictInText(text, data.tambon, false)) {
            parts.push(`ต.${data.tambon}`);
        }
        if (isDistrictInText(text, data.amphure, false)) {
            parts.push(`อ.${data.amphure}`);
        }
        if (isProvinceInText(text, data.province)) {
            parts.push(`จ.${data.province}`);
        }
    }
    if (data.zip_code) {
        parts.push(data.zip_code);
    }
    return parts.join(' ');
}

function suggestAddressByText(text, provinces) {
    let bestMatch = null;
    let maxScore = 0;

    for (let p of provinces) {
        let pScore = 1 - getMatchScore(text, p.name_th, "P", p.name_th);
        for (let d of p.districts) {
            let cleanAmphure = d.name_th.replace("เขต", "");
            let aScore = 1 - getMatchScore(text, cleanAmphure, "A", p.name_th);
            
            for (let s of d.sub_districts) {
                let tScore = 1 - getMatchScore(text, s.name_th, "T", p.name_th);
                let totalScore = pScore + aScore + tScore;
                
                if (totalScore > maxScore) {
                    maxScore = totalScore;
                    bestMatch = {
                        tambon: s.name_th,
                        amphure: d.name_th,
                        province: p.name_th,
                        zip_code: s.zip_code,
                        score: maxScore
                    };
                }
            }
        }
    }
    return bestMatch;
}

// ==========================================
// STORAGE RETENTION HELPERS
// ==========================================
function getRetentionTime(item) {
    return item.lastUsedAt || item.updatedAt || item.savedAt || item.createdAt || item.id || 0;
}

function pruneByImportance(items, maxItems) {
    const list = Array.isArray(items) ? items.slice() : [];
    if (list.length <= maxItems) return list;

    const pinned = list.filter((item) => item.pinned === true || item.isDefault === true);
    const normal = list
        .filter((item) => item.pinned !== true && item.isDefault !== true)
        .sort((a, b) => getRetentionTime(b) - getRetentionTime(a));

    return pinned.concat(normal.slice(0, Math.max(0, maxItems - pinned.length)));
}

function createSynthesizedHistoryData(data) {
    return {
        sender: {
            name: data.sender?.name || '',
            tel: data.sender?.tel || '',
            address: data.sender?.address || '',
            postcode: data.sender?.postcode || ''
        },
        receivers: (data.receivers || []).map((receiver) => ({
            name: receiver.name || '',
            tel: receiver.tel || '',
            address: receiver.address || '',
            postcode: receiver.postcode || '',
            note: receiver.note || ''
        }))
    };
}

// ==========================================
// 💾 CACHE SYSTEM (chrome.storage.local)
// ==========================================
function saveToCache() {
    const cacheData = {
        sender: {
            name: document.getElementById('rev_sname')?.value || '',
            tel: document.getElementById('rev_stel')?.value || '',
            address: document.getElementById('rev_saddress')?.value || '',
            postcode: document.getElementById('rev_spostcode')?.value || ''
        },
        receivers: receiverList.map((receiver) => ({
            name: receiver.name || '',
            tel: receiver.tel || '',
            address: receiver.address || '',
            postcode: receiver.postcode || '',
            note: receiver.note || ''
        })),
        activeTab: activeTab,
        timestamp: Date.now()
    };
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ 'bulkPrintCache': cacheData }, () => {
            console.log('✅ Cache saved');
        });
    }
}

function loadCache() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['bulkPrintCache'], (result) => {
            if (result && result.bulkPrintCache) {
                const cache = result.bulkPrintCache;
                
                if (cache.activeTab) {
                    activeTab = cache.activeTab;
                    switchTab(activeTab);
                }
                
                const status = document.getElementById('status');
                status.innerText = `📂 โหลดข้อความล่าสุดจากแคช (${new Date(cache.timestamp).toLocaleString('th-TH')})`;
                status.className = "status-text info";
            }
        });
    }
}

function setupAutoCache() {
    const fieldsToWatch = ['rev_sname', 'rev_stel', 'rev_saddress', 'rev_spostcode'];
    fieldsToWatch.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                saveToCache();
            });
        }
    });
    
    const senderInput = document.getElementById('senderInput');
    const receiverInput = document.getElementById('receiverInput');
    const combinedInput = document.getElementById('combinedInput');
    
    if (senderInput) {
        senderInput.addEventListener('input', () => {
            saveToCache();
        });
    }
    if (receiverInput) {
        receiverInput.addEventListener('input', () => {
            saveToCache();
        });
    }
    if (combinedInput) {
        combinedInput.addEventListener('input', () => {
            saveToCache();
        });
    }
}

function clearCache() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove('bulkPrintCache');
    }
}

// ==========================================
// 📜 HISTORY SYSTEM (5 รายการล่าสุด)
// ==========================================
function saveToHistory(data) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['scanHistory'], (result) => {
            let history = result.scanHistory || [];
            
            const synthesizedData = createSynthesizedHistoryData(data);
            const receiverCount = synthesizedData.receivers?.length || 0;
            const firstReceiver = synthesizedData.receivers?.[0]?.name || 'ไม่ระบุชื่อ';
            const displayName = receiverCount > 1 
                ? `${firstReceiver} +อีก ${receiverCount - 1} คน`
                : firstReceiver;
            
            const label = `${data.sender?.name || 'ไม่ระบุ'} → ${displayName}`;
            
            const newItem = { 
                id: Date.now(), 
                displayLabel: label,
                data: synthesizedData,
                savedAt: Date.now(),
                timestamp: new Date().toLocaleString('th-TH')
            };
            
            history.unshift(newItem);
            history = pruneByImportance(history, MAX_SCAN_HISTORY);
            
            chrome.storage.local.set({ scanHistory: history }, () => {
                renderHistoryUI();
            });
        });
    }
}

function renderHistoryUI() {
    const container = document.getElementById('historyList');
    const showMoreBtn = document.getElementById('showMoreHistoryBtn');
    if (!container) return;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['scanHistory'], (result) => {
            const history = result.scanHistory || [];
            container.innerHTML = '';
            
            if (history.length === 0) {
                container.innerHTML = '<div style="color: #94a3b8; font-size: 11px; text-align: center; padding: 12px 0;">ยังไม่มีประวัติการสแกน</div>';
                if (showMoreBtn) showMoreBtn.style.display = 'none';
                return;
            }

            const visibleHistory = historyExpanded ? history : history.slice(0, HISTORY_COLLAPSED_LIMIT);
            if (showMoreBtn) {
                showMoreBtn.style.display = history.length > HISTORY_COLLAPSED_LIMIT ? 'block' : 'none';
                showMoreBtn.textContent = historyExpanded ? 'แสดงน้อยลง' : `แสดงเพิ่มเติม (${history.length - HISTORY_COLLAPSED_LIMIT})`;
                showMoreBtn.onclick = () => {
                    historyExpanded = !historyExpanded;
                    renderHistoryUI();
                };
            }

            visibleHistory.forEach((item, index) => {
                const btn = document.createElement('button');
                btn.style.cssText = `
                    width: 100%; text-align: left; padding: 10px 12px; 
                    background: white; border: 1px solid #e2e8f0; border-radius: 8px; 
                    font-size: 12px; cursor: pointer; 
                    display: flex; justify-content: space-between; align-items: center; 
                    box-shadow: 0 1px 1px rgba(0,0,0,0.02); 
                    transition: all 0.15s ease;
                    margin: 0;
                `;
                
                btn.innerHTML = `
                    <div style="flex: 1; min-width: 0;">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; font-weight: 500; margin-bottom: 2px;">
                            ${escapeHTML(item.displayLabel)}
                        </div>
                        <div style="font-size: 10px; color: #94a3b8;">
                            ${item.timestamp}
                        </div>
                    </div>
                    <span style="color: #2563eb; font-size: 13px; font-weight: bold; margin-left: 8px; white-space: nowrap;">
                        👁️ โหลด
                    </span>
                `;
                
                btn.onmouseover = () => {
                    btn.style.background = "#eff6ff";
                    btn.style.borderColor = "#bfdbfe";
                };
                btn.onmouseout = () => {
                    btn.style.background = "white";
                    btn.style.borderColor = "#e2e8f0";
                };
                
                btn.onclick = () => {
                    populateReviewForm(item.data);
                    document.getElementById('inputSection').classList.add('hidden');
                    document.getElementById('reviewSection').classList.add('active');
                    document.getElementById('historySection').style.display = 'none';
                    
                    const status = document.getElementById('status');
                    status.innerText = `📂 โหลดข้อมูลย้อนหลังจากประวัติ (${item.timestamp})`;
                    status.className = "status-text info";
                    
                    saveToCache();
                };
                
                container.appendChild(btn);
            });
        });
    }
}

function clearHistory() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove('scanHistory', () => {
            renderHistoryUI();
            const status = document.getElementById('status');
            status.innerText = "🗑️ ลบประวัติทั้งหมดแล้ว";
            status.className = "status-text";
        });
    }
}

// ==========================================
// 📒 SENDER ADDRESS BOOK SYSTEM
// ==========================================
function getSenderAddressBookSearchText(sender) {
    return [
        sender.alias,
        sender.name,
        sender.tel,
        sender.address,
        sender.postcode
    ].map(normalizeDirectoryText).join(' ');
}


function saveSenderToAddressBook() {
    const senderData = {
        name: document.getElementById('rev_sname')?.value || '',
        tel: document.getElementById('rev_stel')?.value || '',
        address: document.getElementById('rev_saddress')?.value || '',
        postcode: document.getElementById('rev_spostcode')?.value || '',
        alias: '',
        savedAt: Date.now(),
        id: Date.now().toString()
    };
    
    if (!senderData.name && !senderData.address) {
        return;
    }
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['savedSenders'], (result) => {
            let senders = result.savedSenders || [];
            
            const isDuplicate = senders.some(s => 
                s.name === senderData.name && 
                s.address === senderData.address &&
                s.postcode === senderData.postcode
            );
            
            if (isDuplicate) {
                senders = senders.map(s => (
                    s.name === senderData.name && s.address === senderData.address && s.postcode === senderData.postcode
                        ? { ...s, tel: senderData.tel, savedAt: Date.now() }
                        : s
                ));
            } else {
                senders.unshift(senderData);
            }
            
            senders = pruneByImportance(senders, MAX_SAVED_SENDERS);
            chrome.storage.local.set({ savedSenders: senders }, () => {
                console.log('✅ Sender saved to address book');
                renderSenderAddressBook();
            });
        });
    }
}

function loadSenderToForm(senderData) {
    if (document.getElementById('rev_sname')) {
        document.getElementById('rev_sname').value = senderData.name || '';
        document.getElementById('rev_stel').value = senderData.tel || '';
        document.getElementById('rev_saddress').value = senderData.address || '';
        document.getElementById('rev_spostcode').value = senderData.postcode || '';
        
        if (!document.getElementById('inputSection').classList.contains('hidden')) {
            document.getElementById('senderInput').value = 
                `${senderData.name}\n${senderData.tel}\n${senderData.address}\n${senderData.postcode}`;
        }
        
        saveToCache();
        
        const status = document.getElementById('status');
        status.innerText = `📒 โหลดข้อมูลผู้ส่ง: ${senderData.name || 'ไม่ระบุชื่อ'}`;
        status.className = "status-text info";
    }
}

function renameSenderAddressBookItem(senderId) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['savedSenders'], (result) => {
            let senders = result.savedSenders || [];
            const sender = senders.find(s => s.id === senderId);
            if (!sender) return;

            const defaultAlias = sender.alias || sender.name || sender.tel || 'ผู้ส่ง';
            const alias = prompt('ตั้งชื่อเรียกผู้ส่ง', defaultAlias);
            if (alias === null) return;
            const cleanAlias = alias.trim();
            if (!cleanAlias) return;

            senders = senders.map(s => (
                s.id === senderId ? { ...s, alias: cleanAlias, savedAt: Date.now() } : s
            ));
            senders = pruneByImportance(senders, MAX_SAVED_SENDERS);
            chrome.storage.local.set({ savedSenders: senders }, () => {
                renderSenderAddressBook();
                const status = document.getElementById('status');
                status.innerText = 'ตั้งชื่อเรียกผู้ส่งแล้ว: ' + cleanAlias;
                status.className = 'status-text success';
            });
        });
    }
}

function toggleSenderPin(senderId) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['savedSenders'], (result) => {
            let senders = result.savedSenders || [];
            senders = senders.map(s => (
                s.id === senderId ? { ...s, pinned: s.pinned !== true, savedAt: Date.now() } : s
            ));
            senders = pruneByImportance(senders, MAX_SAVED_SENDERS);
            chrome.storage.local.set({ savedSenders: senders }, () => {
                renderSenderAddressBook();
            });
        });
    }
}

function deleteSenderFromAddressBook(senderId) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['savedSenders'], (result) => {
            let senders = result.savedSenders || [];
            senders = senders.filter(s => s.id !== senderId);
            
            chrome.storage.local.set({ savedSenders: senders }, () => {
                console.log('🗑️ Sender deleted from address book');
                renderSenderAddressBook();
                
                const status = document.getElementById('status');
                status.innerText = "🗑️ ลบผู้ส่งออกจากสมุดจดแล้ว";
                status.className = "status-text";
            });
        });
    }
}

function renderSendersList(senders, container) {
    container.innerHTML = '';
    
    senders.forEach((sender) => {
        const item = document.createElement('div');
        item.className = 'address-book-item';
        
        const displayParts = [];
        if (sender.alias) displayParts.push(`<strong>${escapeHTML(sender.alias)}</strong>`);
        if (sender.name) displayParts.push(sender.alias ? escapeHTML(sender.name) : `<strong>${escapeHTML(sender.name)}</strong>`);
        if (sender.tel) displayParts.push(`📞 ${escapeHTML(sender.tel)}`);
        if (sender.postcode) displayParts.push(`📮 ${escapeHTML(sender.postcode)}`);
        
        const truncatedAddress = sender.address ? 
            (sender.address.length > 30 ? sender.address.substring(0, 30) + '...' : sender.address) : '';
        
        item.innerHTML = `
            <div style="flex: 1; min-width: 0;" title="${escapeHTML(sender.address || '')}">
                <div style="margin-bottom: 2px;">${displayParts.join(' | ')}</div>
                ${truncatedAddress ? `<div style="color: #64748b; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(truncatedAddress)}</div>` : ''}
                <div style="color: #94a3b8; font-size: 9px; margin-top: 2px;">
                    💾 ${new Date(sender.savedAt).toLocaleString('th-TH')}
                </div>
            </div>
            <button class="pin-sender-btn" data-sender-id="${sender.id}" title="ปักหมุดผู้ส่งนี้" style="border:1px solid #fcd34d; background:#fef3c7; color:#92400e; border-radius:6px; cursor:pointer; font-size:10px; padding:4px 6px; margin-right:4px;">${sender.pinned ? 'เลิกปัก' : 'ปัก'}</button>
            <button class="edit-sender-alias-btn" data-sender-id="${sender.id}" title="ตั้งชื่อเรียกผู้ส่ง" style="border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:6px; cursor:pointer; font-size:10px; padding:4px 6px; margin-right:4px;">ชื่อ</button>
            <button class="delete-sender-btn" data-sender-id="${sender.id}" title="ลบผู้ส่งนี้ออกจากสมุดจด">🗑️</button>
        `;
        
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('delete-sender-btn')) {
                loadSenderToForm(sender);
            }
        });
        
        const pinBtn = item.querySelector('.pin-sender-btn');
        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSenderPin(sender.id);
        });
        
        const editAliasBtn = item.querySelector('.edit-sender-alias-btn');
        editAliasBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renameSenderAddressBookItem(sender.id);
        });
        
        const deleteBtn = item.querySelector('.delete-sender-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`ต้องการลบผู้ส่ง "${sender.name || 'ไม่ระบุชื่อ'}" ออกจากสมุดจดใช่หรือไม่?`)) {
                deleteSenderFromAddressBook(sender.id);
            }
        });
        
        container.appendChild(item);
    });
}

function renderSenderAddressBook() {
    const containerInput = document.getElementById('addressBookList');
    const containerReview = document.getElementById('addressBookListReview');
    const searchInput = document.getElementById('senderAddressBookSearch');
    const searchReview = document.getElementById('senderAddressBookSearchReview');
    
    if (!containerInput && !containerReview) return;
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['savedSenders'], (result) => {
            const baseSenders = result.savedSenders || [];
            const inputQuery = normalizeDirectoryText(searchInput?.value || '');
            const reviewQuery = normalizeDirectoryText(searchReview?.value || '');
            const senders = baseSenders.slice().sort((a, b) => {
                if ((a.pinned === true) !== (b.pinned === true)) return a.pinned ? -1 : 1;
                return getRetentionTime(b) - getRetentionTime(a);
            });
            
            if (containerInput) {
                const inputSenders = inputQuery ? senders.filter(sender => getSenderAddressBookSearchText(sender).includes(inputQuery)) : senders;
                if (baseSenders.length === 0) {
                    containerInput.innerHTML = '<div style="color: #94a3b8; font-size: 11px; text-align: center; padding: 8px 0;">ยังไม่มีผู้ส่งที่บันทึกไว้</div>';
                } else if (inputSenders.length === 0) {
                    containerInput.innerHTML = '<div style="color: #94a3b8; font-size: 11px; text-align: center; padding: 8px 0;">ไม่พบผู้ส่งที่ค้นหา</div>';
                } else {
                    renderSendersList(inputSenders, containerInput);
                }
            }
            
            if (containerReview) {
                const reviewSenders = reviewQuery ? senders.filter(sender => getSenderAddressBookSearchText(sender).includes(reviewQuery)) : senders;
                if (baseSenders.length === 0) {
                    containerReview.innerHTML = '<div style="color: #94a3b8; font-size: 11px; text-align: center; padding: 8px 0;">ยังไม่มีผู้ส่งที่บันทึกไว้</div>';
                } else if (reviewSenders.length === 0) {
                    containerReview.innerHTML = '<div style="color: #94a3b8; font-size: 11px; text-align: center; padding: 8px 0;">ไม่พบผู้ส่งที่ค้นหา</div>';
                } else {
                    renderSendersList(reviewSenders, containerReview);
                }
            }
        });
    }
}


// ==========================================
// FREQUENT RECEIVER DIRECTORY
// ==========================================
const SAVED_RECEIVERS_KEY = 'savedReceivers';

function normalizeDirectoryText(value) {
    return (value || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function getReceiverDirectoryFingerprint(receiver) {
    return [
        normalizeDirectoryText(receiver.name),
        normalizeDirectoryText(receiver.tel),
        normalizeDirectoryText(receiver.address),
        normalizeDirectoryText(receiver.postcode),
        normalizeDirectoryText(receiver.note)
    ].join('|');
}

function getReceiverDirectorySearchText(receiver) {
    return [
        receiver.alias,
        receiver.name,
        receiver.tel,
        receiver.address,
        receiver.postcode,
        receiver.note
    ].map(normalizeDirectoryText).join(' ');
}

function saveReceiverToDirectory(index) {
    const receiver = receiverList[index];
    if (!receiver) return;

    const defaultAlias = receiver.name || receiver.tel || receiver.postcode || 'ลูกค้าประจำ';
    const alias = prompt('ตั้งชื่อเรียกลูกค้าประจำ', defaultAlias);
    if (alias === null) return;

    const cleanAlias = alias.trim() || defaultAlias;
    const now = Date.now();
    const item = {
        id: now.toString(),
        alias: cleanAlias,
        name: receiver.name || '',
        tel: receiver.tel || '',
        address: receiver.address || '',
        postcode: receiver.postcode || '',
        note: receiver.note || '',
        pinned: false,
        savedAt: now,
        updatedAt: now,
        lastUsedAt: 0
    };
    const fingerprint = getReceiverDirectoryFingerprint(item);

    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        let savedReceivers = result[SAVED_RECEIVERS_KEY] || [];
        const duplicateIndex = savedReceivers.findIndex((saved) => getReceiverDirectoryFingerprint(saved) === fingerprint);

        if (duplicateIndex >= 0) {
            const existing = savedReceivers[duplicateIndex];
            savedReceivers[duplicateIndex] = {
                ...existing,
                ...item,
                id: existing.id,
                pinned: existing.pinned === true,
                savedAt: existing.savedAt || now,
                updatedAt: now
            };
        } else {
            savedReceivers.unshift(item);
        }

        savedReceivers = pruneByImportance(savedReceivers, MAX_SAVED_RECEIVERS);
        chrome.storage.local.set({ [SAVED_RECEIVERS_KEY]: savedReceivers }, () => {
            renderSavedReceiverDirectory();
            const status = document.getElementById('status');
            status.innerText = 'บันทึกเข้าสมุดจดผู้รับที่เคยใช้แล้ว: ' + cleanAlias;
            status.className = 'status-text success';
        });
    });
}

function appendReceiverFromDirectory(receiverId) {
    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        const savedReceivers = result[SAVED_RECEIVERS_KEY] || [];
        const receiver = savedReceivers.find((item) => item.id === receiverId);
        if (!receiver) return;

        const now = Date.now();
        const nextReceivers = savedReceivers.map((item) => (
            item.id === receiverId ? { ...item, lastUsedAt: now, updatedAt: now } : item
        ));
        chrome.storage.local.set({ [SAVED_RECEIVERS_KEY]: pruneByImportance(nextReceivers, MAX_SAVED_RECEIVERS) });

        receiverList.push({
            name: receiver.name || '',
            tel: receiver.tel || '',
            address: receiver.address || '',
            postcode: receiver.postcode || '',
            note: receiver.note || ''
        });
        renderReceiverCards();
        saveToCache();

        const status = document.getElementById('status');
        status.innerText = 'เพิ่มลูกค้าจากทำเนียบแล้ว: ' + (receiver.alias || receiver.name || 'ไม่ระบุชื่อ');
        status.className = 'status-text success';
    });
}

function toggleReceiverDirectoryPin(receiverId) {
    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        const savedReceivers = (result[SAVED_RECEIVERS_KEY] || []).map((item) => (
            item.id === receiverId ? { ...item, pinned: item.pinned !== true, updatedAt: Date.now() } : item
        ));
        chrome.storage.local.set({ [SAVED_RECEIVERS_KEY]: savedReceivers }, renderSavedReceiverDirectory);
    });
}

function renameReceiverDirectoryItem(receiverId) {
    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        const savedReceivers = result[SAVED_RECEIVERS_KEY] || [];
        const receiver = savedReceivers.find((item) => item.id === receiverId);
        if (!receiver) return;

        const alias = prompt('แก้ชื่อเรียกลูกค้าประจำ', receiver.alias || receiver.name || '');
        if (alias === null) return;
        const cleanAlias = alias.trim();
        if (!cleanAlias) return;

        const nextReceivers = savedReceivers.map((item) => (
            item.id === receiverId ? { ...item, alias: cleanAlias, updatedAt: Date.now() } : item
        ));
        chrome.storage.local.set({ [SAVED_RECEIVERS_KEY]: nextReceivers }, renderSavedReceiverDirectory);
    });
}

function deleteReceiverFromDirectory(receiverId) {
    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        const savedReceivers = result[SAVED_RECEIVERS_KEY] || [];
        const receiver = savedReceivers.find((item) => item.id === receiverId);
        if (!receiver) return;

        if (!confirm('ลบ "' + (receiver.alias || receiver.name || 'ลูกค้าประจำ') + '" ออกจากทำเนียบใช่ไหม?')) return;

        const nextReceivers = savedReceivers.filter((item) => item.id !== receiverId);
        chrome.storage.local.set({ [SAVED_RECEIVERS_KEY]: nextReceivers }, () => {
            renderSavedReceiverDirectory();
            const status = document.getElementById('status');
            status.innerText = 'ลบลูกค้าประจำออกจากทำเนียบแล้ว';
            status.className = 'status-text';
        });
    });
}

function renderSavedReceiverDirectory() {
    const container = document.getElementById('receiverDirectoryList');
    const countEl = document.getElementById('receiverDirectoryCount');
    const searchEl = document.getElementById('receiverDirectorySearch');
    if (!container) return;

    chrome.storage.local.get([SAVED_RECEIVERS_KEY], (result) => {
        const savedReceivers = result[SAVED_RECEIVERS_KEY] || [];
        const query = normalizeDirectoryText(searchEl?.value || '');
        const filtered = savedReceivers
            .filter((item) => !query || getReceiverDirectorySearchText(item).includes(query))
            .sort((a, b) => {
                if ((a.pinned === true) !== (b.pinned === true)) return a.pinned ? -1 : 1;
                return getRetentionTime(b) - getRetentionTime(a);
            });

        if (countEl) countEl.textContent = savedReceivers.length + ' รายการ';
        container.innerHTML = '';

        if (savedReceivers.length === 0) {
            container.innerHTML = '<div style="color:#9ca3af; font-size:11px; text-align:center; padding:10px 0;">ยังไม่มีผู้รับที่บันทึกไว้</div>';
            return;
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div style="color:#9ca3af; font-size:11px; text-align:center; padding:10px 0;">ไม่พบรายการที่ค้นหา</div>';
            return;
        }

        filtered.forEach((receiver) => {
            const item = document.createElement('div');
            item.style.cssText = 'background:#fff; border:1px solid #fed7aa; border-radius:8px; padding:8px; display:flex; gap:8px; align-items:flex-start;';
            const address = receiver.address || '';
            const shortAddress = address.length > 52 ? address.substring(0, 52) + '...' : address;

            item.innerHTML = `
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; font-weight:bold; color:#9a3412; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${receiver.pinned ? 'ปักหมุด ' : ''}${escapeHTML(receiver.alias || receiver.name || 'ไม่ระบุชื่อ')}
                    </div>
                    <div style="font-size:11px; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${escapeHTML(receiver.name || '')} ${receiver.tel ? ' | ' + escapeHTML(receiver.tel) : ''} ${receiver.postcode ? ' | ' + escapeHTML(receiver.postcode) : ''}
                    </div>
                    ${shortAddress ? `<div style="font-size:10px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHTML(address)}">${escapeHTML(shortAddress)}</div>` : ''}
                </div>
                <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="receiver-dir-add" data-id="${receiver.id}" style="background:#16a34a; color:white; border:0; border-radius:6px; font-size:10px; font-weight:bold; padding:5px 7px; cursor:pointer;">เพิ่ม</button>
                    <button class="receiver-dir-pin" data-id="${receiver.id}" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d; border-radius:6px; font-size:10px; padding:5px 7px; cursor:pointer;">${receiver.pinned ? 'เลิกปัก' : 'ปัก'}</button>
                    <button class="receiver-dir-edit" data-id="${receiver.id}" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; font-size:10px; padding:5px 7px; cursor:pointer;">ชื่อ</button>
                    <button class="receiver-dir-delete" data-id="${receiver.id}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; border-radius:6px; font-size:10px; padding:5px 7px; cursor:pointer;">ลบ</button>
                </div>
            `;

            container.appendChild(item);
        });

        container.querySelectorAll('.receiver-dir-add').forEach((btn) => {
            btn.addEventListener('click', () => appendReceiverFromDirectory(btn.dataset.id));
        });
        container.querySelectorAll('.receiver-dir-pin').forEach((btn) => {
            btn.addEventListener('click', () => toggleReceiverDirectoryPin(btn.dataset.id));
        });
        container.querySelectorAll('.receiver-dir-edit').forEach((btn) => {
            btn.addEventListener('click', () => renameReceiverDirectoryItem(btn.dataset.id));
        });
        container.querySelectorAll('.receiver-dir-delete').forEach((btn) => {
            btn.addEventListener('click', () => deleteReceiverFromDirectory(btn.dataset.id));
        });
    });
}

// ==========================================
// ⚙️ INITIALIZATION & SETTINGS
// ==========================================
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['geminiApiKey', 'selectedModel', 'savedSenderText'], (result) => {
        if (result.geminiApiKey) { 
            document.getElementById('apiKey').value = result.geminiApiKey; 
            fetchAvailableModels(result.geminiApiKey, result.selectedModel); 
        }
        if (result.savedSenderText) {
            document.getElementById('senderInput').value = result.savedSenderText;
        }
    });
}

document.getElementById('senderInput').addEventListener('input', (e) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ savedSenderText: e.target.value });
    }
});

async function fetchAvailableModels(key, savedModel) {
    const select = document.getElementById('modelSelect');
    const statusDot = document.getElementById('modelStatus');
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!response.ok) throw new Error("API Key Invalid");
        const data = await response.json();
        const models = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
        select.innerHTML = '';

        // Define preferred model keys, human-friendly labels, and matching priority
        const modelDefinitions = [
            { key: 'gemini-2.5-flash-lite', label: '🍃 Gemini 2.5 Flash-Lite (ประหยัดค่าใช้จ่ายสูงสุด)' },
            { key: 'gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash (แนะนำ - เร็วและแม่นยำสุด)' },
            { key: 'gemini-2.0-flash-lite', label: '🍃 Gemini 2.0 Flash-Lite (ประหยัดค่าใช้จ่าย)' },
            { key: 'gemini-2.0-flash', label: '🚀 Gemini 2.0 Flash (ทำงานเร็วและเสถียร)' },
            { key: 'gemini-2.5-pro', label: '🧠 Gemini 2.5 Pro (ฉลาดสุด - เหมาะกับรูปไม่ชัด/ลายมือ)' },
            { key: 'gemini-3.1-flash', label: '✨ Gemini 3.1 Flash (รุ่นทดสอบ)' },
            { key: 'gemini-3.1-pro', label: '🔮 Gemini 3.1 Pro (รุ่นทดสอบ)' },
            { key: 'gemini-3-flash', label: '✨ Gemini 3 Flash (รุ่นทดสอบ)' },
            { key: 'gemini-3-pro', label: '🔮 Gemini 3 Pro (รุ่นทดสอบ)' },
            { key: 'gemini-flash-latest', label: '⚡ Gemini Flash (Latest)' },
            { key: 'gemini-pro-latest', label: '🧠 Gemini Pro (Latest)' },
            { key: 'gemini-1.5-flash', label: '⚡ Gemini 1.5 Flash (รุ่นคลาสสิก)' },
            { key: 'gemini-1.5-pro', label: '🧠 Gemini 1.5 Pro (รุ่นคลาสสิก)' }
        ];

        let mappedModels = [];
        models.forEach(model => {
            const nameLower = model.name.toLowerCase();
            // Find the first matching definition (specific key matches like -lite first)
            const defIndex = modelDefinitions.findIndex(def => nameLower.includes(def.key));
            if (defIndex !== -1) {
                mappedModels.push({
                    model: model,
                    def: modelDefinitions[defIndex],
                    index: defIndex
                });
            }
        });

        // Sort by the order in modelDefinitions
        mappedModels.sort((a, b) => a.index - b.index);

        if (mappedModels.length === 0) {
            // Fallback: If no matches, show all generateContent models
            models.forEach(model => {
                const opt = document.createElement('option'); 
                opt.value = model.name; 
                opt.innerText = model.displayName || model.name.split('/')[1];
                if (model.name === savedModel) opt.selected = true;
                select.appendChild(opt);
            });
        } else {
            mappedModels.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.model.name;
                opt.innerText = item.def.label;
                if (item.model.name === savedModel) opt.selected = true;
                select.appendChild(opt);
            });

            // Set default if none selected
            if (!savedModel && select.options.length > 0) {
                // Find and select 2.5 Flash if available, otherwise first item
                const flash25Opt = Array.from(select.options).find(o => o.value.includes('gemini-2.5-flash') && !o.value.includes('lite'));
                if (flash25Opt) {
                    flash25Opt.selected = true;
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ selectedModel: flash25Opt.value });
                    }
                } else {
                    select.options[0].selected = true;
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ selectedModel: select.options[0].value });
                    }
                }
            }
        }
        statusDot.className = 'status-dot online';
    } catch (err) {
        select.innerHTML = '<option value="">Check API Key</option>'; 
        statusDot.className = 'status-dot offline';
    }
}

document.getElementById('apiKey').addEventListener('input', (e) => {
    const key = e.target.value.trim();
    if (key) { 
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set({ geminiApiKey: key }); 
        fetchAvailableModels(key); 
    }
});

document.getElementById('modelSelect').addEventListener('change', (e) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set({ selectedModel: e.target.value });
});

document.getElementById('refreshModels').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim(); 
    if (key) fetchAvailableModels(key);
});

// ==========================================
// 📸 DRAG & DROP (BOTH ZONES)
// ==========================================
const processImageFile = (file, zoneType) => {
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            const base64Data = base64.split(',')[1];
            const previewDiv = document.getElementById(zoneType + 'Preview'); 
            const input = document.getElementById(zoneType + 'Input');
            
            if (zoneType === 'sender') senderImageData = base64Data;
            else if (zoneType === 'combined') combinedImageData = base64Data;
            else if (zoneType === 'reviewAddReceiver') reviewAddReceiverImageData = base64Data;
            else receiverImageData = base64Data;

            previewDiv.innerHTML = ''; 
            const wrapper = document.createElement('div'); 
            wrapper.style.position = 'relative'; 
            wrapper.style.display = 'inline-block';
            
            const img = document.createElement('img'); 
            img.src = base64; 
            img.className = 'preview-img';
            
            const delBtn = document.createElement('button'); 
            delBtn.innerText = '❌'; 
            delBtn.style.position = 'absolute'; delBtn.style.top = '-8px'; delBtn.style.right = '-8px'; 
            delBtn.style.background = 'white'; delBtn.style.border = '1px solid #e2e8f0'; 
            delBtn.style.borderRadius = '50%'; delBtn.style.cursor = 'pointer'; delBtn.style.fontSize = '10px'; delBtn.style.padding = '4px';

            delBtn.addEventListener('click', () => {
                if (zoneType === 'sender') senderImageData = null;
                else if (zoneType === 'combined') combinedImageData = null;
                else if (zoneType === 'reviewAddReceiver') reviewAddReceiverImageData = null;
                else receiverImageData = null;
                previewDiv.innerHTML = ''; 
                previewDiv.classList.remove('active');
                input.value = input.value.replace(/\[แนบรูปภาพแล้ว.*?\]/g, '').trim();
            });
            
            wrapper.appendChild(img); wrapper.appendChild(delBtn); 
            previewDiv.appendChild(wrapper); previewDiv.classList.add('active');
        };
        reader.readAsDataURL(file);
    }
};

const setupDragAndDrop = (zoneId, inputId, zoneType) => {
    const zone = document.getElementById(zoneId); 
    const input = document.getElementById(inputId);
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0]; 
            processImageFile(file, zoneType);
            input.value = input.value + (input.value ? '\n' : '') + `[แนบรูปภาพแล้ว: ${file.name}]`;
        } else {
            const textData = e.dataTransfer.getData('text/plain'); 
            if (textData) input.value = input.value + (input.value ? '\n' : '') + textData;
        }
    });
    input.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                const file = items[i].getAsFile(); 
                processImageFile(file, zoneType);
                input.value = input.value + (input.value ? '\n' : '') + `[แนบรูปภาพแล้ว]`;
            }
        }
    });
};

setupDragAndDrop('senderZone', 'senderInput', 'sender');
setupDragAndDrop('receiverZone', 'receiverInput', 'receiver');
setupDragAndDrop('combinedZone', 'combinedInput', 'combined');
setupDragAndDrop('reviewAddReceiverZone', 'reviewAddReceiverInput', 'reviewAddReceiver');

document.getElementById('clearSenderBtn').addEventListener('click', () => {
    document.getElementById('senderInput').value = ''; 
    senderImageData = null; 
    const preview = document.getElementById('senderPreview'); 
    preview.innerHTML = ''; preview.classList.remove('active');
    saveToCache();
});

document.getElementById('clearReceiverBtn').addEventListener('click', () => {
    document.getElementById('receiverInput').value = ''; 
    receiverImageData = null; 
    const preview = document.getElementById('receiverPreview'); 
    preview.innerHTML = ''; preview.classList.remove('active');
    saveToCache();
});

const clearReviewAddReceiverInput = () => {
    const input = document.getElementById('reviewAddReceiverInput');
    const preview = document.getElementById('reviewAddReceiverPreview');
    if (input) input.value = '';
    reviewAddReceiverImageData = null;
    if (preview) {
        preview.innerHTML = '';
        preview.classList.remove('active');
    }
};

const clearReviewAddReceiverBtn = document.getElementById('clearReviewAddReceiverBtn');
if (clearReviewAddReceiverBtn) {
    clearReviewAddReceiverBtn.addEventListener('click', () => {
        clearReviewAddReceiverInput();
        saveToCache();
    });
}

const clearCombinedBtn = document.getElementById('clearCombinedBtn');
if (clearCombinedBtn) {
    clearCombinedBtn.addEventListener('click', () => {
        document.getElementById('combinedInput').value = ''; 
        combinedImageData = null; 
        const preview = document.getElementById('combinedPreview'); 
        if (preview) {
            preview.innerHTML = ''; preview.classList.remove('active');
        }
        saveToCache();
    });
}

document.getElementById('clearAllBtn').addEventListener('click', () => {
    document.getElementById('clearSenderBtn').click();
    document.getElementById('clearReceiverBtn').click();
    const clearCombined = document.getElementById('clearCombinedBtn');
    if (clearCombined) clearCombined.click();
    clearCache();
    document.getElementById('status').innerText = "ล้างข้อมูลเรียบร้อย พร้อมรับงานใหม่!";
    document.getElementById('status').className = "status-text";
});

// ==========================================
// 🧠 AI EXTRACTION (BULK PROCESSING)
// ==========================================
async function requestGeminiJson(parts, model, apiKey) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const json = await resp.json();
    if (json.error) throw new Error(json.error.message);

    const responseText = json.candidates[0].content.parts[0].text;
    return JSON.parse(responseText.match(/\{[\s\S]*\}/)[0]);
}

function openManualReview() {
    if (receiverList.length === 0) {
        receiverList = [{ name: '', tel: '', address: '', postcode: '', note: '' }];
    }

    renderReceiverCards();
    renderSenderAddressBook();
    renderSavedReceiverDirectory();
    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('reviewSection').classList.add('active');
    document.getElementById('historySection').style.display = 'none';
    saveToCache();

    const status = document.getElementById('status');
    status.innerText = 'เข้าสู่หน้าตรวจสอบแล้ว สามารถกรอกหรือเพิ่มผู้รับเองได้เลย';
    status.className = 'status-text info';
}

document.getElementById('skipToReviewBtn')?.addEventListener('click', openManualReview);

document.getElementById('processBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('modelSelect').value;
    const status = document.getElementById('status');

    if (!apiKey || !model) { 
        status.innerText = "⚠️ กรุณาใส่ API Key ให้เรียบร้อยครับ"; 
        status.className = "status-text error"; 
        return; 
    }

    let promptText = `Task: Extract shipping info for Thailand domestic post. Keep the language in THAI.
    CRITICAL RULES:
    1. Parse the Sender info carefully. VERY IMPORTANT: Separate the 5-digit POSTCODE into its own 'postcode' field for sender too.
    2. The Receiver info may contain MULTIPLE people (Bulk). Parse them into an array.
    3. VERY IMPORTANT: Separate the 5-digit POSTCODE into its own 'postcode' field for receivers. DO NOT include it in the 'address' field.
    4. VERY IMPORTANT: If receivers have extra info like "IG Account", "Facebook name", "Notes to rider" (e.g., บ้านรั้วสีขาว, ฝากส่งต่อ), DO NOT discard them! Put them in the 'note' field.
    5. DO NOT add spaces after abbreviations like "ต.", "อ.", "จ.", "ม.", "ซ.". They must stick to the following word.
    6. EXTREMELY IMPORTANT: Do NOT fabricate, guess, or fill in any data that is NOT explicitly present in the original input text. If the input does not contain a postcode, leave the 'postcode' field as "". If the input does not contain a sub-district name, do NOT add one. If the input does not contain a province name, do NOT add one. Only extract what is actually written. Output ONLY what exists in the original text.
    
    Return ONLY valid JSON:
    {
      "sender": { "name": "", "tel": "", "address": "เฉพาะข้อมูลที่มีใน input เท่านั้น", "postcode": "รหัสไปรษณีย์ 5 หลัก ถ้ามี หรือ เว้นว่าง" },
      "receivers": [
        { "name": "", "tel": "", "address": "เฉพาะข้อมูลที่มีใน input เท่านั้น", "postcode": "รหัสไปรษณีย์ 5 หลัก ถ้ามี หรือ เว้นว่าง", "note": "" }
      ]
    }`;

    let parts = [];

    if (activeTab === 'separate') {
        const senderText = document.getElementById('senderInput').value.trim();
        const receiverText = document.getElementById('receiverInput').value.trim();

        if (!senderText && !senderImageData) {
            status.innerText = "⚠️ กรุณาใส่ข้อมูลผู้ส่งก่อนครับ (ข้อความหรือรูปภาพ)"; 
            status.className = "status-text error"; 
            return; 
        }
        if (!receiverText && !receiverImageData) {
            status.innerText = "⚠️ กรุณาใส่ข้อมูลผู้รับก่อนครับ (ข้อความหรือรูปภาพ)"; 
            status.className = "status-text error"; 
            return; 
        }

        parts.push({ text: promptText });
        parts.push({ text: `Sender Text: ${senderText}` });
        if (senderImageData) parts.push({ inlineData: { mimeType: "image/png", data: senderImageData } });
        
        parts.push({ text: `Receivers Input (Can be multiple people): ${receiverText}` });
        if (receiverImageData) parts.push({ inlineData: { mimeType: "image/png", data: receiverImageData } });
    } else {
        const combinedText = document.getElementById('combinedInput').value.trim();

        if (!combinedText && !combinedImageData) {
            status.innerText = "⚠️ กรุณาใส่ข้อมูลผู้ส่งและผู้รับก่อนครับ (ข้อความหรือรูปภาพ)"; 
            status.className = "status-text error"; 
            return; 
        }

        promptText += `\n7. The input provided contains BOTH the Sender and the Receivers combined. Analyze the text/images to identify which address/name belongs to the Sender (the one sending/shipping) and which belongs to the Receivers (the ones receiving).`;

        parts.push({ text: promptText });
        parts.push({ text: `Combined Input (Contains Sender and Receivers): ${combinedText}` });
        if (combinedImageData) parts.push({ inlineData: { mimeType: "image/png", data: combinedImageData } });
    }

    status.innerText = "Gemini กำลังวิเคราะห์แยกรายชื่อลูกค้า..."; 
    status.className = "status-text info";

    try {
        const cleanData = await requestGeminiJson(parts, model, apiKey);

        populateReviewForm(cleanData);
        saveToCache();
        saveToHistory(cleanData);

        document.getElementById('inputSection').classList.add('hidden');
        document.getElementById('reviewSection').classList.add('active');
        document.getElementById('historySection').style.display = 'none';
        
        status.innerText = `✅ วิเคราะห์เสร็จสิ้น! พบลูกค้าทั้งหมด ${cleanData.receivers.length} รายการ`;
        status.className = "status-text success";

    } catch (err) {
        console.error(err);
        status.innerText = "Error: " + err.message + " (ลองกดวิเคราะห์ใหม่อีกครั้งครับ)"; 
        status.className = "status-text error";
    }
});

document.getElementById('addReceiverFromReviewBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('modelSelect').value;
    const status = document.getElementById('status');
    const input = document.getElementById('reviewAddReceiverInput');
    const receiverText = input ? input.value.trim() : '';

    if (!apiKey || !model) {
        status.innerText = "⚠️ กรุณาใส่ API Key ให้เรียบร้อยครับ";
        status.className = "status-text error";
        return;
    }

    if (!receiverText && !reviewAddReceiverImageData) {
        status.innerText = "⚠️ กรุณาใส่ข้อความหรือรูปภาพลูกค้าที่ต้องการเพิ่ม";
        status.className = "status-text error";
        return;
    }

    const promptText = `Task: Extract ONLY receiver/customer shipping info for Thailand domestic post. Keep Thai language.
CRITICAL RULES:
1. The input may contain ONE or MANY receivers. Parse all clear receivers into the receivers array.
2. Separate the 5-digit postcode into the "postcode" field. Do not include it in "address".
3. Extra info like IG, Facebook, landmark, note to rider, house color, orฝากส่งต่อ goes into "note".
4. Do NOT fabricate missing data. If a field is not explicitly present, leave it as "".
5. Output ONLY valid JSON:
{
  "receivers": [
    { "name": "", "tel": "", "address": "", "postcode": "", "note": "" }
  ]
}`;

    const parts = [
        { text: promptText },
        { text: `Receivers Input To Append: ${receiverText}` }
    ];
    if (reviewAddReceiverImageData) parts.push({ inlineData: { mimeType: "image/png", data: reviewAddReceiverImageData } });

    status.innerText = "Gemini กำลังเพิ่มลูกค้าเข้ารายการ...";
    status.className = "status-text info";

    try {
        const cleanData = await requestGeminiJson(parts, model, apiKey);
        const addedReceivers = (cleanData.receivers || []).filter(r =>
            r && (r.name || r.tel || r.address || r.postcode || r.note)
        );

        if (addedReceivers.length === 0) {
            status.innerText = "⚠️ ไม่พบลูกค้าใหม่จากข้อมูลที่ใส่ กรุณาตรวจข้อความ/รูปอีกครั้ง";
            status.className = "status-text error";
            return;
        }

        receiverList = receiverList.concat(addedReceivers);
        renderReceiverCards();
        saveToCache();
        clearReviewAddReceiverInput();

        status.innerText = `✅ เพิ่มลูกค้าใหม่ ${addedReceivers.length} รายการแล้ว รวมทั้งหมด ${receiverList.length} รายการ`;
        status.className = "status-text success";
    } catch (err) {
        console.error(err);
        status.innerText = "Error: " + err.message + " (ลองเพิ่มใหม่อีกครั้งครับ)";
        status.className = "status-text error";
    }
});

// ==========================================
// 📝 REVIEW & EDIT LOGIC
// ==========================================
function escapeHTML(str) {
    return (str || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function populateReviewForm(data) {
    if (data.sender) {
        document.getElementById('rev_sname').value = data.sender.name || '';
        document.getElementById('rev_stel').value = data.sender.tel || '';
        document.getElementById('rev_saddress').value = data.sender.address || '';
        document.getElementById('rev_spostcode').value = data.sender.postcode || ''; 
    }
    receiverList = data.receivers || [];
    renderReceiverCards();
    renderSenderAddressBook();
    renderSavedReceiverDirectory();
}

function renderReceiverCards() {
    const container = document.getElementById('receiversList');
    container.innerHTML = ''; 

    receiverList.forEach((r, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.background = '#f8fafc';
        card.style.border = '1px solid #cbd5e1';
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label style="margin: 0; color: #0284c7;">👤 ลูกค้าคนที่ ${index + 1}</label>
                <div style="display: flex; gap: 4px;">
                    <button class="validate-btn" data-index="${index}" style="background:#dbeafe; border:1px solid #93c5fd; color:#1e40af; font-size:10px; padding:4px 8px; border-radius:6px; cursor:pointer; font-weight:bold; white-space: nowrap;">
                        🔍 ตรวจสอบ
                    </button>
                    <button class="save-receiver-btn" data-index="${index}" style="background:#fff7ed; border:1px solid #fdba74; color:#c2410c; font-size:10px; padding:4px 8px; border-radius:6px; cursor:pointer; font-weight:bold; white-space: nowrap;">บันทึกผู้รับ</button>
                    <button class="del-btn" data-index="${index}" style="background:none; border:none; color:#ef4444; font-size:14px; cursor:pointer;" title="ลบคนนี้">🗑️</button>
                </div>
            </div>
            <div class="review-grid">
                <div class="review-field full" style="display:grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                    <div><label>ชื่อ-นามสกุล</label><input type="text" class="update-field" data-index="${index}" data-field="name" value="${escapeHTML(r.name)}"></div>
                    <div><label>เบอร์โทร</label><input type="text" class="update-field" data-index="${index}" data-field="tel" value="${escapeHTML(r.tel)}"></div>
                </div>
                <div class="review-field full"><label>ที่อยู่จัดส่ง</label><textarea style="height: 40px;" class="update-field" data-index="${index}" data-field="address">${escapeHTML(r.address)}</textarea></div>
                <div class="review-field full" style="display:grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                    <div><label>📌 หมายเหตุ / Username</label><input type="text" class="update-field" data-index="${index}" data-field="note" value="${escapeHTML(r.note)}" style="border-color:#eab308; background:#fefce8;" placeholder="เช่น ชื่อ IG, รั้วสีขาว..."></div>
                    <div><label style="color:#dc2626;">รหัสไปรษณีย์</label><input type="text" class="update-field" data-index="${index}" data-field="postcode" value="${escapeHTML(r.postcode)}" style="border-color:#dc2626; font-weight:bold; font-size:14px; text-align:center;"></div>
                </div>
            </div>
            <div class="validate-result" id="validateResult-${index}" style="display:none; margin-top:8px; padding:10px; border-radius:6px; font-size:11px; line-height:1.6; white-space: pre-line;">
            </div>
        `;
        container.appendChild(card);
    });

    document.querySelectorAll('.save-receiver-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
            saveReceiverToDirectory(idx);
        });
    });

    document.querySelectorAll('.del-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
            if(confirm("แน่ใจหรือไม่ว่าต้องการลบลูกค้ารายการนี้?")) {
                receiverList.splice(idx, 1);
                renderReceiverCards();
                saveToCache();
                document.getElementById('status').innerText = `เหลือลูกค้า ${receiverList.length} รายการ`;
            }
        });
    });

    document.querySelectorAll('.validate-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
            const resultDiv = document.getElementById(`validateResult-${idx}`);
            const btnEl = e.currentTarget;
            
            if (resultDiv.style.display === 'block') {
                resultDiv.style.display = 'none';
                btnEl.innerHTML = '🔍 ตรวจสอบ';
                btnEl.style.background = '#dbeafe';
                return;
            }
            
            resultDiv.style.display = 'block';
            resultDiv.style.background = '#eff6ff';
            resultDiv.style.border = '1px solid #bfdbfe';
            resultDiv.style.color = '#1e40af';
            resultDiv.innerHTML = '⏳ กำลังตรวจสอบ...';
            btnEl.innerHTML = '⏳ กำลังตรวจ...';
            btnEl.style.background = '#e2e8f0';
            
            await initDatabases();
            
            const result = validateReceiverAddress(idx);
            
            if (result) {
                resultDiv.innerHTML = result.message;
                
                if (result.status === 'correct') {
                    resultDiv.style.background = '#dcfce7';
                    resultDiv.style.border = '1px solid #86efac';
                    resultDiv.style.color = '#166534';
                    btnEl.innerHTML = '🟢 ดูผลลัพธ์ (กดซ่อน)';
                    btnEl.style.background = '#dcfce7';
                } else if (result.status === 'warning') {
                    resultDiv.style.background = '#fef3c7';
                    resultDiv.style.border = '1px solid #fcd34d';
                    resultDiv.style.color = '#92400e';
                    btnEl.innerHTML = '🟡 ดูผลลัพธ์ (กดซ่อน)';
                    btnEl.style.background = '#fef3c7';
                } else if (result.status === 'wrong') {
                    resultDiv.style.background = '#fee2e2';
                    resultDiv.style.border = '1px solid #fca5a5';
                    resultDiv.style.color = '#991b1b';
                    btnEl.innerHTML = '🔴 ดูผลลัพธ์ (กดซ่อน)';
                    btnEl.style.background = '#fee2e2';
                } else {
                    resultDiv.style.background = '#f1f5f9';
                    resultDiv.style.border = '1px solid #cbd5e1';
                    resultDiv.style.color = '#475569';
                    btnEl.innerHTML = '🔍 ตรวจสอบ';
                    btnEl.style.background = '#dbeafe';
                }
            }
        });    
    });

    document.querySelectorAll('.update-field').forEach(field => {
        field.addEventListener('input', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'), 10);
            const fieldName = e.target.getAttribute('data-field');
            receiverList[idx][fieldName] = e.target.value;
            saveToCache();
            
            const resultDiv = document.getElementById(`validateResult-${idx}`);
            if (resultDiv) {
                resultDiv.style.display = 'none';
            }
        });
    });
}

document.getElementById('cancelBtn').addEventListener('click', () => {
    document.getElementById('inputSection').classList.remove('hidden'); 
    document.getElementById('reviewSection').classList.remove('active');
    document.getElementById('historySection').style.display = 'block';
    renderHistoryUI();
    
    document.getElementById('status').innerText = "แก้ไขข้อมูลได้เลยครับ"; 
    document.getElementById('status').className = "status-text";
});

// ==========================================
// ✨ ABBREVIATION HELPER
// ==========================================
function formatAddressForPrint(text) {
    if (!text) return "";
    
    let formatted = text
        .replace(/ตำบล\s*/g, 'ต.')
        .replace(/อำเภอ\s*/g, 'อ.')
        .replace(/จังหวัด\s*/g, 'จ.');

    formatted = formatted.replace(/(ต\.|อ\.|จ\.|ม\.|ซ\.|ถ\.)\s+/g, '$1');
    formatted = formatted.replace(/([^\s])(ต\.|อ\.|จ\.|ม\.|ซ\.|ถ\.)/g, '$1 $2');
    formatted = formatted.replace(/\s+/g, ' ').trim();
    formatted = formatted.replace(/(ต\.|อ\.|จ\.|ม\.|ซ\.|ถ\.)([^\s]+)/g, '<span style="white-space: nowrap;">$1$2</span>');

    return formatted;
}

// ==========================================
// 📞 PHONE NUMBER FORMATTER
// ==========================================
function formatPhoneNumber(tel) {
    if (!tel) return "";
    
    const cleanTel = tel.toString().replace(/\D/g, ''); 
    
    if (cleanTel.length === 10) {
        return cleanTel.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    } else if (cleanTel.length === 9) {
        return cleanTel.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
    }
    
    return tel; 
}

// ==========================================
// PRINT PRESET ENGINE
// ==========================================
const PRINT_SETTINGS_KEY = 'thaiPostBulkPrintSettings';

const printPaperPresets = {
    '10x10': { label: '10x10 cm', pageWidthMm: 100, pageHeightMm: 100, sheetWidthMm: 100, sheetHeightMm: 100, layout: 'standard' },
    '4x6': { label: '4x6 Shipping Label', pageWidthMm: 101.6, pageHeightMm: 152.4, sheetWidthMm: 101.6, sheetHeightMm: 152.4, layout: 'standard' },
    'a6': { label: 'A6', pageWidthMm: 105, pageHeightMm: 148, sheetWidthMm: 105, sheetHeightMm: 148, layout: 'standard' },
    'a5': { label: 'A5', pageWidthMm: 148, pageHeightMm: 210, sheetWidthMm: 148, sheetHeightMm: 210, layout: 'standard' },
    'a4-2up': { label: 'A4 2-up', pageWidthMm: 210, pageHeightMm: 297, sheetWidthMm: 190, sheetHeightMm: 135, gapMm: 8, pagePaddingMm: 8, layout: 'two-up' },
    'a4-box': { label: 'A4 แนวนอน - จ่าหน้ากล่อง', pageWidthMm: 297, pageHeightMm: 210, sheetWidthMm: 297, sheetHeightMm: 210, layout: 'box-diagonal' }
};

const defaultPrintSettings = {
    paper: '10x10',
    fontScale: 1,
    fromScale: 1,
    toScale: 1,
    paddingMm: 0,
    spacing: 1.15,
    border: true,
    fromToSplit: 34
};

let currentPrintSettings = { ...defaultPrintSettings };

function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizePrintSettings(settings = {}) {
    const paper = printPaperPresets[settings.paper] ? settings.paper : defaultPrintSettings.paper;
    return {
        ...defaultPrintSettings,
        ...settings,
        paper,
        fontScale: clampNumber(settings.fontScale, 0.65, 1.6, defaultPrintSettings.fontScale),
        fromScale: clampNumber(settings.fromScale, 0.65, 1.6, defaultPrintSettings.fromScale),
        toScale: clampNumber(settings.toScale, 0.65, 1.6, defaultPrintSettings.toScale),
        paddingMm: clampNumber(settings.paddingMm, 0, 6, defaultPrintSettings.paddingMm),
        spacing: clampNumber(settings.spacing, 0.9, 1.6, defaultPrintSettings.spacing),
        fromToSplit: clampNumber(settings.fromToSplit, 18, 55, defaultPrintSettings.fromToSplit),
        border: settings.border !== false
    };
}

function getPrintPreset(settings = currentPrintSettings) {
    return printPaperPresets[settings.paper] || printPaperPresets[defaultPrintSettings.paper];
}

function savePrintSettings(settings = currentPrintSettings) {
    currentPrintSettings = normalizePrintSettings(settings);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [PRINT_SETTINGS_KEY]: currentPrintSettings });
    }
}

function loadPrintSettings(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        currentPrintSettings = normalizePrintSettings(currentPrintSettings);
        callback(currentPrintSettings);
        return;
    }

    chrome.storage.local.get([PRINT_SETTINGS_KEY], (result) => {
        currentPrintSettings = normalizePrintSettings(result?.[PRINT_SETTINGS_KEY] || currentPrintSettings);
        callback(currentPrintSettings);
    });
}

function syncPrintPresetControls(settings = currentPrintSettings) {
    const select = document.getElementById('printPaperPresetSelect');
    if (select) select.value = normalizePrintSettings(settings).paper;
}

function openPrintPreviewWithSettings(settings = currentPrintSettings) {
    const nextSettings = normalizePrintSettings(settings);
    savePrintSettings(nextSettings);
    openPrintPreview(nextSettings);
    syncPrintPresetControls(nextSettings);
}

function installPrintPreviewTools(printWindow, settings = currentPrintSettings) {
    const doc = printWindow.document;
    const MIN_FONT_PT = 6;
    const MAX_FONT_PT = 46;
    let selectedBlock = null;
    let editorSettings = normalizePrintSettings(settings);

    function numberFromDataset(el, name, fallback) {
        const value = parseFloat(el.dataset[name]);
        return Number.isFinite(value) ? value : fallback;
    }

    function getContentSizeMm(page) {
        return {
            w: numberFromDataset(page, 'contentWMm', 90),
            h: numberFromDataset(page, 'contentHMm', 90)
        };
    }

    function applyBlockPosition(block) {
        block.style.left = numberFromDataset(block, 'xMm', 0) + 'mm';
        block.style.top = numberFromDataset(block, 'yMm', 0) + 'mm';
        block.style.width = numberFromDataset(block, 'wMm', 20) + 'mm';
        block.style.height = numberFromDataset(block, 'hMm', 10) + 'mm';
    }

    function getPxPerMm(page) {
        const content = page.querySelector('.label-content');
        const size = getContentSizeMm(page);
        if (!content || !size.w) return 1;
        return content.clientWidth / size.w;
    }

    function pxToMm(px, page) {
        return px / getPxPerMm(page);
    }

    function clampBlockToPage(block, nextX, nextY) {
        const page = block.closest('.label-page');
        const size = getContentSizeMm(page);
        const width = numberFromDataset(block, 'wMm', 20);
        const height = numberFromDataset(block, 'hMm', 10);
        const maxX = Math.max(0, size.w - width);
        const maxY = Math.max(0, size.h - height);

        return {
            x: Math.min(Math.max(0, nextX), maxX),
            y: Math.min(Math.max(0, nextY), maxY)
        };
    }

    function clampBlockSize(block, nextW, nextH) {
        const page = block.closest('.label-page');
        const size = getContentSizeMm(page);
        const x = numberFromDataset(block, 'xMm', 0);
        const y = numberFromDataset(block, 'yMm', 0);
        const minW = numberFromDataset(block, 'minWMm', 12);
        const minH = numberFromDataset(block, 'minHMm', 6);
        const maxW = Math.max(minW, size.w - x);
        const maxH = Math.max(minH, size.h - y);

        return {
            w: Math.min(Math.max(minW, nextW), maxW),
            h: Math.min(Math.max(minH, nextH), maxH)
        };
    }

    function getBlockText(block) {
        return block ? block.querySelector('.block-text[data-fit-box]') : null;
    }

    function getRoleScale(textEl) {
        const block = textEl.closest('.draggable-block');
        return block && block.classList.contains('sender-zone') ? editorSettings.fromScale : editorSettings.toScale;
    }

    function applyTextFont(textEl, baseSize) {
        const min = numberFromDataset(textEl, 'minPt', MIN_FONT_PT);
        const max = numberFromDataset(textEl, 'maxPt', MAX_FONT_PT);
        const cleanBase = Math.min(Math.max(min, baseSize), max);
        textEl.dataset.fontPt = cleanBase.toFixed(1);
        textEl.style.fontSize = (cleanBase * editorSettings.fontScale * getRoleScale(textEl)).toFixed(2) + 'pt';
    }

    function isOverflowing(textEl) {
        return textEl.scrollHeight > textEl.clientHeight + 1 || textEl.scrollWidth > textEl.clientWidth + 1;
    }

    function checkOneBox(textEl) {
        const stillOverflowing = isOverflowing(textEl);
        textEl.classList.toggle('has-overflow', stillOverflowing);
        return !stillOverflowing;
    }

    function fitOneBox(textEl) {
        const max = numberFromDataset(textEl, 'fontPt', numberFromDataset(textEl, 'maxPt', 14));
        const min = numberFromDataset(textEl, 'minPt', MIN_FONT_PT);
        let size = max;

        textEl.classList.remove('has-overflow');
        applyTextFont(textEl, size);

        while (isOverflowing(textEl) && size > min) {
            size = Math.max(min, size - 0.5);
            applyTextFont(textEl, size);
        }

        return checkOneBox(textEl);
    }

    function getCurrentFontSize(textEl) {
        const value = parseFloat(textEl.dataset.fontPt || textEl.dataset.maxPt);
        return Number.isFinite(value) ? value : numberFromDataset(textEl, 'maxPt', 14);
    }

    function updateOverflowStatus() {
        const pages = Array.from(doc.querySelectorAll('.label-page'));
        let warningCount = 0;

        pages.forEach((page) => {
            const hasOverflow = !!page.querySelector('.block-text.has-overflow');
            page.classList.toggle('has-overflow', hasOverflow);
            if (hasOverflow) warningCount += 1;
        });

        const statusEl = doc.getElementById('fitStatus');
        if (!statusEl) return;

        statusEl.classList.toggle('warning', warningCount > 0);
        statusEl.textContent = warningCount > 0
            ? 'ยังล้น ' + warningCount + ' ใบ'
            : 'ข้อความพอดีทุกใบ';
    }

    function refreshFontToolbar() {
        const slider = doc.getElementById('fontSizeSlider');
        const valueEl = doc.getElementById('fontSizeValue');
        const selectedEl = doc.getElementById('selectedBlockName');
        const hasSelection = !!selectedBlock && isEditMode();
        const textEl = getBlockText(selectedBlock);
        const fontSize = textEl ? getCurrentFontSize(textEl) : 0;

        if (selectedEl) selectedEl.textContent = hasSelection ? (selectedBlock.dataset.label || 'กล่องที่เลือก') : 'ยังไม่ได้เลือกกล่อง';
        if (slider) {
            slider.disabled = !hasSelection;
            if (hasSelection) slider.value = fontSize.toFixed(1);
        }
        if (valueEl) valueEl.textContent = hasSelection ? fontSize.toFixed(1) + ' pt' : '-';

        ['fontDecreaseBtn', 'fontIncreaseBtn', 'fitSelectedBtn'].forEach((id) => {
            const btn = doc.getElementById(id);
            if (btn) btn.disabled = !hasSelection;
        });
    }

    function applySplitToPage(page) {
        if (!page || page.dataset.paper !== '10x10' || page.dataset.layout !== 'standard') return;
        const sender = page.querySelector('.sender-zone');
        const name = page.querySelector('.r-name-tel');
        const address = page.querySelector('.r-address-text');
        const note = page.querySelector('.r-note');
        const postcode = page.querySelector('.r-postcode');
        const split = editorSettings.fromToSplit;

        if (sender) {
            sender.dataset.hMm = Math.max(10, split - 3).toFixed(2);
            applyBlockPosition(sender);
        }
        if (name) {
            name.dataset.yMm = (split + 1).toFixed(2);
            applyBlockPosition(name);
        }
        if (address) {
            address.dataset.yMm = (split + 16).toFixed(2);
            address.dataset.hMm = Math.max(16, 70 - split).toFixed(2);
            applyBlockPosition(address);
        }
        if (note) {
            note.dataset.yMm = '73';
            applyBlockPosition(note);
        }
        if (postcode) {
            postcode.dataset.yMm = '72';
            applyBlockPosition(postcode);
        }
    }

    function applyPrintEditorSettings() {
        doc.documentElement.style.setProperty('--print-padding-mm', editorSettings.paddingMm + 'mm');
        doc.documentElement.style.setProperty('--print-line-height', editorSettings.spacing);
        doc.body.classList.toggle('print-border-off', !editorSettings.border);

        doc.querySelectorAll('.block-text[data-fit-box]').forEach((textEl) => {
            applyTextFont(textEl, getCurrentFontSize(textEl));
        });

        doc.querySelectorAll('.from-to-splitter').forEach((splitter) => {
            const page = splitter.closest('.label-page');
            splitter.style.top = editorSettings.fromToSplit + 'mm';
            applySplitToPage(page);
        });

        savePrintSettings(editorSettings);
        checkAllLabels();
        refreshFontToolbar();
    }

    function checkAllLabels() {
        doc.querySelectorAll('.draggable-block').forEach(applyBlockPosition);
        doc.querySelectorAll('.block-text[data-fit-box]').forEach(checkOneBox);
        updateOverflowStatus();
    }

    function fitAllLabels() {
        doc.querySelectorAll('.draggable-block').forEach(applyBlockPosition);
        doc.querySelectorAll('.block-text[data-fit-box]').forEach(fitOneBox);
        updateOverflowStatus();
        refreshFontToolbar();
    }

    function setEditMode(enabled) {
        doc.body.classList.toggle('edit-mode', enabled);
        doc.querySelectorAll('.block-text[contenteditable]').forEach((textEl) => {
            textEl.setAttribute('contenteditable', enabled ? 'true' : 'false');
        });

        if (!enabled) {
            if (selectedBlock) selectedBlock.classList.remove('is-selected');
            selectedBlock = null;
        } else if (!selectedBlock) {
            selectedBlock = doc.querySelector('.draggable-block');
            if (selectedBlock) selectedBlock.classList.add('is-selected');
        }

        refreshFontToolbar();
        checkAllLabels();
    }

    function isEditMode() {
        return doc.body.classList.contains('edit-mode');
    }

    function setSelectedBlock(block) {
        if (!isEditMode()) return;

        if (selectedBlock === block) {
            refreshFontToolbar();
            return;
        }

        if (selectedBlock) selectedBlock.classList.remove('is-selected');
        selectedBlock = block;
        if (selectedBlock) selectedBlock.classList.add('is-selected');
        refreshFontToolbar();
    }

    function applyManualFontSize(block, size) {
        const textEl = getBlockText(block);
        if (!textEl) return;

        const min = numberFromDataset(textEl, 'minPt', MIN_FONT_PT);
        const nextSize = Math.min(Math.max(min, size), MAX_FONT_PT);
        applyTextFont(textEl, nextSize);
        checkOneBox(textEl);
        syncMatchingBlocks(block, { font: true });
        updateOverflowStatus();
        refreshFontToolbar();
    }

    function updateSelectedFontSize(deltaOrValue, mode = 'delta') {
        if (!selectedBlock) return;
        const textEl = getBlockText(selectedBlock);
        if (!textEl) return;

        const current = getCurrentFontSize(textEl);
        const next = mode === 'absolute' ? parseFloat(deltaOrValue) : current + deltaOrValue;
        applyManualFontSize(selectedBlock, next);
    }

    function getBlockRole(block) {
        const roles = ['sender-zone', 'r-name-tel', 'r-address-text', 'r-note', 'r-postcode'];
        return roles.find((role) => block.classList.contains(role)) || '';
    }

    function copyBlockLayout(sourceBlock, targetBlock) {
        ['xMm', 'yMm', 'wMm', 'hMm'].forEach((key) => {
            targetBlock.dataset[key] = sourceBlock.dataset[key];
        });

        const sourceText = sourceBlock.querySelector('.block-text[data-fit-box]');
        const targetText = targetBlock.querySelector('.block-text[data-fit-box]');
        if (sourceText && targetText) {
            targetText.dataset.fontPt = sourceText.dataset.fontPt || sourceText.dataset.maxPt;
            applyTextFont(targetText, getCurrentFontSize(targetText));
        }

        applyBlockPosition(targetBlock);
        if (targetText) checkOneBox(targetText);
    }

    function applyFirstLayoutToAll() {
        const pages = Array.from(doc.querySelectorAll('.label-page'));
        if (pages.length < 2) {
            updateOverflowStatus();
            return;
        }

        const firstBlocksByRole = new Map();
        pages[0].querySelectorAll('.draggable-block').forEach((block) => {
            const role = getBlockRole(block);
            if (role) firstBlocksByRole.set(role, block);
        });

        pages.slice(1).forEach((page) => {
            page.querySelectorAll('.draggable-block').forEach((targetBlock) => {
                const sourceBlock = firstBlocksByRole.get(getBlockRole(targetBlock));
                if (sourceBlock) copyBlockLayout(sourceBlock, targetBlock);
            });
        });

        checkAllLabels();
    }

    function syncMatchingBlocks(sourceBlock, options = { text: false, layout: false }) {
        const syncKey = sourceBlock.dataset.sync;
        if (!syncKey) return;

        doc.querySelectorAll('.draggable-block[data-sync="' + syncKey + '"]').forEach((targetBlock) => {
            if (targetBlock === sourceBlock) return;

            if (options.text) {
                const sourceText = sourceBlock.querySelector('.block-text');
                const targetText = targetBlock.querySelector('.block-text');
                if (sourceText && targetText) targetText.innerHTML = sourceText.innerHTML;
            }

            if (options.layout) {
                targetBlock.dataset.xMm = sourceBlock.dataset.xMm;
                targetBlock.dataset.yMm = sourceBlock.dataset.yMm;
                targetBlock.dataset.wMm = sourceBlock.dataset.wMm;
                targetBlock.dataset.hMm = sourceBlock.dataset.hMm;
                applyBlockPosition(targetBlock);
            }

            if (options.font) {
                const sourceText = sourceBlock.querySelector('.block-text');
                const targetText = targetBlock.querySelector('.block-text');
                if (sourceText && targetText) {
                    targetText.dataset.fontPt = sourceText.dataset.fontPt;
                    applyTextFont(targetText, getCurrentFontSize(targetText));
                }
            }

            const textEl = targetBlock.querySelector('.block-text[data-fit-box]');
            if (textEl) checkOneBox(textEl);
        });
    }

    function startBlockDrag(event, block) {
        if (!isEditMode()) return;
        event.preventDefault();
        setSelectedBlock(block);
        block.classList.add('is-dragging');

        const page = block.closest('.label-page');
        const pxPerMm = getPxPerMm(page);
        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = numberFromDataset(block, 'xMm', 0);
        const startTop = numberFromDataset(block, 'yMm', 0);

        function moveBlock(moveEvent) {
            const next = clampBlockToPage(
                block,
                startLeft + (moveEvent.clientX - startX) / pxPerMm,
                startTop + (moveEvent.clientY - startY) / pxPerMm
            );

            block.dataset.xMm = next.x.toFixed(2);
            block.dataset.yMm = next.y.toFixed(2);
            applyBlockPosition(block);
            syncMatchingBlocks(block, { layout: true });
            checkAllLabels();
        }

        function stopDrag() {
            block.classList.remove('is-dragging');
            doc.removeEventListener('pointermove', moveBlock);
            doc.removeEventListener('pointerup', stopDrag);
            checkAllLabels();
        }

        doc.addEventListener('pointermove', moveBlock);
        doc.addEventListener('pointerup', stopDrag);
    }

    function startBlockResize(event, block) {
        if (!isEditMode()) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedBlock(block);
        block.classList.add('is-resizing');

        const page = block.closest('.label-page');
        const pxPerMm = getPxPerMm(page);
        const startX = event.clientX;
        const startY = event.clientY;
        const startW = numberFromDataset(block, 'wMm', 20);
        const startH = numberFromDataset(block, 'hMm', 10);

        function resizeBlock(moveEvent) {
            const next = clampBlockSize(
                block,
                startW + (moveEvent.clientX - startX) / pxPerMm,
                startH + (moveEvent.clientY - startY) / pxPerMm
            );

            block.dataset.wMm = next.w.toFixed(2);
            block.dataset.hMm = next.h.toFixed(2);
            applyBlockPosition(block);
            syncMatchingBlocks(block, { layout: true });
            checkAllLabels();
        }

        function stopResize() {
            block.classList.remove('is-resizing');
            doc.removeEventListener('pointermove', resizeBlock);
            doc.removeEventListener('pointerup', stopResize);
            checkAllLabels();
        }

        doc.addEventListener('pointermove', resizeBlock);
        doc.addEventListener('pointerup', stopResize);
    }

    function adjustPrintSetting(key, delta, min, max) {
        editorSettings[key] = Math.min(max, Math.max(min, editorSettings[key] + delta));
        applyPrintEditorSettings();
    }

    function startFromToSplitDrag(event) {
        if (!isEditMode()) return;
        event.preventDefault();
        const page = event.currentTarget.closest('.label-page');
        const startY = event.clientY;
        const startSplit = editorSettings.fromToSplit;

        function moveSplit(moveEvent) {
            const deltaMm = pxToMm(moveEvent.clientY - startY, page);
            editorSettings.fromToSplit = clampNumber(startSplit + deltaMm, 18, 55, startSplit);
            applyPrintEditorSettings();
        }

        function stopSplit() {
            doc.removeEventListener('pointermove', moveSplit);
            doc.removeEventListener('pointerup', stopSplit);
        }

        doc.addEventListener('pointermove', moveSplit);
        doc.addEventListener('pointerup', stopSplit);
    }

    doc.querySelectorAll('.draggable-block').forEach((block) => {
        applyBlockPosition(block);

        block.addEventListener('pointerdown', () => {
            if (isEditMode()) setSelectedBlock(block);
        });

        const handle = block.querySelector('.drag-handle');
        if (handle) handle.addEventListener('pointerdown', (event) => startBlockDrag(event, block));

        const resizeHandle = block.querySelector('.resize-handle');
        if (resizeHandle) resizeHandle.addEventListener('pointerdown', (event) => startBlockResize(event, block));
    });

    doc.querySelectorAll('.from-to-splitter').forEach((splitter) => {
        splitter.addEventListener('pointerdown', startFromToSplitDrag);
    });

    doc.querySelectorAll('.block-text[data-fit-box]').forEach((textEl) => {
        textEl.addEventListener('input', () => {
            const block = textEl.closest('.draggable-block');
            if (block) {
                if (isEditMode()) setSelectedBlock(block);
                syncMatchingBlocks(block, { text: true });
            }
            fitOneBox(textEl);
            updateOverflowStatus();
            refreshFontToolbar();
        });

        textEl.addEventListener('blur', fitAllLabels);
    });

    const editModeToggle = doc.getElementById('editModeToggle');
    if (editModeToggle) editModeToggle.addEventListener('change', (event) => setEditMode(event.target.checked));

    const refitBtn = doc.getElementById('refitBtn');
    if (refitBtn) refitBtn.addEventListener('click', fitAllLabels);

    const fitSelectedBtn = doc.getElementById('fitSelectedBtn');
    if (fitSelectedBtn) {
        fitSelectedBtn.addEventListener('click', () => {
            const textEl = getBlockText(selectedBlock);
            if (!textEl) return;
            fitOneBox(textEl);
            syncMatchingBlocks(selectedBlock, { font: true });
            updateOverflowStatus();
            refreshFontToolbar();
        });
    }

    const decreaseBtn = doc.getElementById('fontDecreaseBtn');
    if (decreaseBtn) decreaseBtn.addEventListener('click', () => updateSelectedFontSize(-1));

    const increaseBtn = doc.getElementById('fontIncreaseBtn');
    if (increaseBtn) increaseBtn.addEventListener('click', () => updateSelectedFontSize(1));

    const fontSlider = doc.getElementById('fontSizeSlider');
    if (fontSlider) fontSlider.addEventListener('input', (event) => updateSelectedFontSize(event.target.value, 'absolute'));

    doc.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            if (action === 'font-dec') adjustPrintSetting('fontScale', -0.05, 0.65, 1.6);
            if (action === 'font-inc') adjustPrintSetting('fontScale', 0.05, 0.65, 1.6);
            if (action === 'from-less') adjustPrintSetting('fromScale', -0.05, 0.65, 1.6);
            if (action === 'from-more') adjustPrintSetting('fromScale', 0.05, 0.65, 1.6);
            if (action === 'to-less') adjustPrintSetting('toScale', -0.05, 0.65, 1.6);
            if (action === 'to-more') adjustPrintSetting('toScale', 0.05, 0.65, 1.6);
            if (action === 'padding-less') adjustPrintSetting('paddingMm', -0.2, 0, 6);
            if (action === 'padding-more') adjustPrintSetting('paddingMm', 0.2, 0, 6);
            if (action === 'spacing-less') adjustPrintSetting('spacing', -0.03, 0.9, 1.6);
            if (action === 'spacing-more') adjustPrintSetting('spacing', 0.03, 0.9, 1.6);
            if (action === 'border-toggle') {
                editorSettings.border = !editorSettings.border;
                applyPrintEditorSettings();
            }
            if (action === 'reset-print-settings') {
                editorSettings = normalizePrintSettings({ paper: editorSettings.paper });
                applyPrintEditorSettings();
                fitAllLabels();
            }
        });
    });

    const applyFirstLayoutBtn = doc.getElementById('applyFirstLayoutBtn');
    if (applyFirstLayoutBtn) applyFirstLayoutBtn.addEventListener('click', applyFirstLayoutToAll);

    const printBtn = doc.getElementById('previewPrintBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            setEditMode(false);
            checkAllLabels();
            printWindow.setTimeout(() => printWindow.print(), 50);
        });
    }

    printWindow.addEventListener('beforeprint', () => {
        setEditMode(false);
        checkAllLabels();
    });
    printWindow.addEventListener('resize', checkAllLabels);

    if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(fitAllLabels).catch(fitAllLabels);
    }

    printWindow.requestAnimationFrame(() => {
        setEditMode(false);
        applyPrintEditorSettings();
        fitAllLabels();
    });
    printWindow.setTimeout(fitAllLabels, 100);
}

function createPrintBlock(className, html, options) {
    const syncAttr = options.sync ? ` data-sync="${options.sync}"` : '';
    return `
        <div class="draggable-block ${className}" data-label="${options.label || className}" data-x-mm="${options.x}" data-y-mm="${options.y}" data-w-mm="${options.w}" data-h-mm="${options.h}" data-min-w-mm="${options.minW || 12}" data-min-h-mm="${options.minH || 6}"${syncAttr}>
            <button class="drag-handle" type="button" title="ลากเพื่อเลื่อนบล็อกนี้">ย้าย</button>
            <div class="block-text" contenteditable="true" data-fit-box data-max-pt="${options.maxPt}" data-min-pt="${options.minPt}" data-font-pt="${options.maxPt}">${html}</div>
            <button class="resize-handle" type="button" title="ลากเพื่อย่อหรือขยายกล่อง"></button>
        </div>
    `;
}

function scaleStandardBlock(box, preset) {
    const xScale = preset.sheetWidthMm / 100;
    const yScale = preset.sheetHeightMm / 100;
    return {
        ...box,
        x: Number((box.x * xScale).toFixed(2)),
        y: Number((box.y * yScale).toFixed(2)),
        w: Number((box.w * xScale).toFixed(2)),
        h: Number((box.h * yScale).toFixed(2))
    };
}

function getCurrentPrintData() {
    const sName = document.getElementById('rev_sname').value;
    const sTel = formatPhoneNumber(document.getElementById('rev_stel').value);
    const sAddress = document.getElementById('rev_saddress').value;
    const sPostcode = document.getElementById('rev_spostcode').value;
    const formattedSenderAddress = formatAddressForPrint(escapeHTML(sAddress));

    return {
        senderHTML: `<strong>ผู้ส่ง:</strong> ${escapeHTML(sName)} ${escapeHTML(sTel)}<br>${formattedSenderAddress} <strong>${escapeHTML(sPostcode)}</strong>`
    };
}

function getReceiverPrintParts(r) {
    const formattedReceiverAddress = formatAddressForPrint(escapeHTML(r.address));
    const formattedRTel = formatPhoneNumber(r.tel);
    return {
        formattedReceiverAddress,
        receiverNameHTML: `กรุณาส่ง: ${escapeHTML(r.name)}<br>โทร: ${escapeHTML(formattedRTel)}`,
        noteHTML: r.note ? `📌 ${escapeHTML(r.note)}` : '',
        postcodeHTML: escapeHTML(r.postcode || '')
    };
}

function buildStandardLabelHTML(r, index, senderHTML, settings, preset) {
    const { formattedReceiverAddress, receiverNameHTML, noteHTML, postcodeHTML } = getReceiverPrintParts(r);
    const contentW = preset.sheetWidthMm - 10;
    const contentH = preset.sheetHeightMm - 10;
    const addressOptions = scaleStandardBlock({ label: 'ที่อยู่', x: 0, y: 39, w: 90, h: 30, maxPt: 18, minPt: 10, minW: 25, minH: 12 }, preset);
    const noteBlock = noteHTML
        ? createPrintBlock('r-note', noteHTML, scaleStandardBlock({ label: 'หมายเหตุ', x: 0, y: 73, w: 52, h: 17, maxPt: 12, minPt: 8, minW: 18, minH: 8 }, preset))
        : '';
    const splitter = settings.paper === '10x10'
        ? '<button class="from-to-splitter edit-only" type="button" aria-label="ปรับพื้นที่ผู้ส่งและผู้รับ"></button>'
        : '';

    return `
        <section class="label-page" data-label-index="${index + 1}" data-paper="${settings.paper}" data-layout="${preset.layout}" data-content-w-mm="${contentW}" data-content-h-mm="${contentH}" style="width:${preset.sheetWidthMm}mm; height:${preset.sheetHeightMm}mm;">
            <div class="label-content">
                ${createPrintBlock('sender-zone', senderHTML, scaleStandardBlock({ label: 'ผู้ส่ง', x: 0, y: 0, w: 90, h: 20, maxPt: 11, minPt: 6.5, minW: 35, minH: 10, sync: 'sender-block' }, preset))}
                ${splitter}
                ${createPrintBlock('r-name-tel', receiverNameHTML, scaleStandardBlock({ label: 'ชื่อ/โทร', x: 0, y: 23, w: 90, h: 13, maxPt: 14, minPt: 9, minW: 35, minH: 8 }, preset))}
                ${createPrintBlock('r-address-text', formattedReceiverAddress, addressOptions)}
                ${noteBlock}
                ${createPrintBlock('r-postcode', postcodeHTML, scaleStandardBlock({ label: 'รหัสไปรษณีย์', x: 58, y: 72, w: 32, h: 18, maxPt: 28, minPt: 18, minW: 22, minH: 12 }, preset))}
            </div>
        </section>
    `;
}

function buildTwoUpPrintPageHTML(pair, startIndex, senderHTML, settings, preset) {
    const labels = pair.map((receiver, offset) => {
        return buildStandardLabelHTML(receiver, startIndex + offset, senderHTML, settings, preset);
    }).join('');

    return `
        <div class="a4-two-up-page" style="width:${preset.pageWidthMm}mm; height:${preset.pageHeightMm}mm; padding:${preset.pagePaddingMm}mm; gap:${preset.gapMm}mm;">
            ${labels}
        </div>
    `;
}

function buildBoxDiagonalLabelHTML(r, index, senderHTML, settings, preset) {
    const { formattedReceiverAddress, receiverNameHTML, noteHTML, postcodeHTML } = getReceiverPrintParts(r);
    const noteBlock = noteHTML
        ? createPrintBlock('r-note', noteHTML, { label: 'หมายเหตุ', x: 154, y: 172, w: 78, h: 18, maxPt: 14, minPt: 8, minW: 40, minH: 10 })
        : '';

    return `
        <section class="label-page box-diagonal-label" data-label-index="${index + 1}" data-paper="${settings.paper}" data-layout="${preset.layout}" data-content-w-mm="287" data-content-h-mm="200" style="width:${preset.sheetWidthMm}mm; height:${preset.sheetHeightMm}mm;">
            <div class="label-content">
                ${createPrintBlock('sender-zone', senderHTML, { label: 'ผู้ส่ง', x: 12, y: 10, w: 122, h: 58, maxPt: 16, minPt: 8, minW: 50, minH: 18, sync: 'sender-block' })}
                ${createPrintBlock('r-name-tel', receiverNameHTML, { label: 'ชื่อ/โทร', x: 154, y: 88, w: 130, h: 32, maxPt: 28, minPt: 12, minW: 50, minH: 14 })}
                ${createPrintBlock('r-address-text', formattedReceiverAddress, { label: 'ที่อยู่', x: 154, y: 122, w: 130, h: 48, maxPt: 26, minPt: 12, minW: 60, minH: 18 })}
                ${noteBlock}
                ${createPrintBlock('r-postcode', postcodeHTML, { label: 'รหัสไปรษณีย์', x: 236, y: 168, w: 48, h: 24, maxPt: 32, minPt: 14, minW: 25, minH: 12 })}
            </div>
        </section>
    `;
}

function buildPrintPreviewHTML(settings = currentPrintSettings) {
    const normalized = normalizePrintSettings(settings);
    const preset = getPrintPreset(normalized);
    const { senderHTML } = getCurrentPrintData();
    let pagesHTML = '';

    if (preset.layout === 'two-up') {
        for (let i = 0; i < receiverList.length; i += 2) {
            pagesHTML += buildTwoUpPrintPageHTML(receiverList.slice(i, i + 2), i, senderHTML, normalized, preset);
        }
    } else {
        receiverList.forEach((r, index) => {
            pagesHTML += preset.layout === 'box-diagonal'
                ? buildBoxDiagonalLabelHTML(r, index, senderHTML, normalized, preset)
                : buildStandardLabelHTML(r, index, senderHTML, normalized, preset);
        });
    }

    return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
        <meta charset="UTF-8">
        <title>จัดจ่าหน้าก่อนพิมพ์ ${preset.label}</title>
        <style>
            @page { size: ${preset.pageWidthMm}mm ${preset.pageHeightMm}mm; margin: 0; }
            @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');

            * { box-sizing: border-box; }

            body {
                margin: 0;
                padding: 0;
                font-family: 'Sarabun', Tahoma, sans-serif;
                background: #e5e7eb;
                color: #111827;
            }

            .preview-toolbar {
                position: sticky;
                top: 0;
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 14px;
                background: #ffffff;
                border-bottom: 1px solid #d1d5db;
                box-shadow: 0 1px 6px rgba(15, 23, 42, 0.12);
            }

            .toolbar-title {
                font-size: 13px;
                font-weight: 700;
                color: #374151;
                line-height: 1.4;
            }

            .toolbar-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                justify-content: flex-end;
            }

            .toolbar-btn {
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #f8fafc;
                color: #334155;
                cursor: pointer;
                font-family: inherit;
                font-size: 12px;
                font-weight: 700;
                padding: 8px 12px;
            }

            .toolbar-btn:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            .toolbar-btn.primary {
                background: #16a34a;
                border-color: #16a34a;
                color: #ffffff;
            }

            .edit-toggle {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border: 1px solid #cbd5e1;
                border-radius: 999px;
                background: #f8fafc;
                color: #334155;
                font-size: 12px;
                font-weight: 700;
                user-select: none;
            }

            .edit-toggle input {
                accent-color: #dc2626;
            }

            .fit-status {
                font-size: 12px;
                font-weight: 700;
                color: #166534;
                min-width: 130px;
                text-align: right;
            }

            .fit-status.warning {
                color: #b91c1c;
            }

            .label-sheet {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 14px;
                padding: 16px;
            }

            .a4-two-up-page {
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                page-break-after: always;
                break-after: page;
                background: #ffffff;
                box-shadow: 0 3px 14px rgba(15, 23, 42, 0.16);
            }

            .a4-two-up-page .label-page {
                page-break-after: auto;
                break-after: auto;
                box-shadow: none;
                border: none;
            }

            body.edit-mode .a4-two-up-page .label-page {
                border: 1px dashed #cbd5e1;
            }

            .label-page {
                padding: 5mm;
                background: #ffffff;
                box-shadow: 0 3px 14px rgba(15, 23, 42, 0.16);
                page-break-after: always;
                break-after: page;
                position: relative;
                overflow: hidden;
            }

            .label-page:last-child {
                page-break-after: auto;
                break-after: auto;
            }

            body.edit-mode .label-page.has-overflow {
                outline: 2px solid #dc2626;
                outline-offset: 3px;
            }

            .label-content {
                width: 100%;
                height: 100%;
                position: relative;
                overflow: hidden;
            }

            .draggable-block {
                position: absolute;
                border: none;
                border-radius: 4px;
                background: transparent;
                overflow: visible;
            }

            body.edit-mode .draggable-block {
                border: 1px dashed rgba(37, 99, 235, 0.65);
            }

            body.edit-mode .draggable-block.is-selected {
                border-color: rgba(37, 99, 235, 0.95);
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.14);
            }

            body.edit-mode .draggable-block.is-dragging,
            body.edit-mode .draggable-block.is-resizing {
                border-color: #16a34a;
                box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.18);
            }

            body:not(.edit-mode) .edit-only,
            body:not(.edit-mode) .drag-handle,
            body:not(.edit-mode) .resize-handle {
                display: none !important;
            }

            body:not(.edit-mode) .block-text.has-overflow {
                box-shadow: none;
            }

            .font-tools,
            .scale-tools {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 6px;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                background: #f8fafc;
                font-size: 12px;
                font-weight: 700;
                color: #334155;
            }

            .font-tools input[type="range"] {
                width: 110px;
                accent-color: #dc2626;
            }

            .selected-block-name {
                max-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #1d4ed8;
            }

            .drag-handle {
                position: absolute;
                top: -7mm;
                left: 0;
                height: 6mm;
                min-width: 13mm;
                border: 1px solid #2563eb;
                border-radius: 4px;
                background: #eff6ff;
                color: #1d4ed8;
                cursor: move;
                font-family: inherit;
                font-size: 9px;
                font-weight: 700;
                line-height: 1;
                padding: 0 5px;
                user-select: none;
            }

            .resize-handle {
                position: absolute;
                right: -2.5mm;
                bottom: -2.5mm;
                width: 5mm;
                height: 5mm;
                border: 1px solid #dc2626;
                border-radius: 50%;
                background: #fee2e2;
                cursor: nwse-resize;
                padding: 0;
            }

            .from-to-splitter {
                position: absolute;
                left: 0;
                width: 90mm;
                height: 3mm;
                border: 0;
                border-radius: 999px;
                background: rgba(37, 99, 235, 0.35);
                cursor: ns-resize;
                z-index: 20;
            }

            .block-text {
                width: 100%;
                height: 100%;
                overflow: hidden;
                outline: none;
                word-break: break-word;
                overflow-wrap: anywhere;
                line-height: var(--print-line-height, 1.15);
                padding: var(--print-padding-mm, 0mm);
            }

            .block-text:focus {
                box-shadow: inset 0 0 0 1.5px #2563eb;
            }

            .block-text.has-overflow {
                box-shadow: inset 0 0 0 2px #dc2626;
            }

            .sender-zone .block-text {
                font-size: 11pt;
                font-weight: 700;
                line-height: calc(var(--print-line-height, 1.15) * 1);
                border-bottom: 2px dashed #000;
                padding-bottom: 1mm;
            }

            .r-name-tel .block-text,
            .r-address-text .block-text {
                font-weight: 700;
            }

            .r-note .block-text {
                font-weight: 700;
                background-color: #f1f5f9;
                border: 1.5px solid #000;
                padding: max(var(--print-padding-mm, 0mm), 1mm) 2mm;
                border-radius: 4px;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .r-postcode .block-text {
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                line-height: 1;
                letter-spacing: 2px;
                border: 2px solid #000;
                border-radius: 6px;
                background-color: #fff;
                white-space: nowrap;
            }

            body.print-border-off .sender-zone .block-text,
            body.print-border-off .r-note .block-text,
            body.print-border-off .r-postcode .block-text {
                border-color: transparent !important;
            }

            [contenteditable="true"] {
                cursor: text;
            }

            @media print {
                body {
                    background: #ffffff;
                }

                .preview-toolbar,
                .drag-handle,
                .resize-handle,
                .edit-only,
                .from-to-splitter {
                    display: none !important;
                }

                .label-sheet {
                    display: block;
                    padding: 0;
                }

                .a4-two-up-page {
                    box-shadow: none;
                    margin: 0;
                }

                .a4-two-up-page .label-page {
                    border: none;
                }

                .label-page {
                    margin: 0;
                    box-shadow: none;
                    outline: none !important;
                }

                .draggable-block,
                .draggable-block.is-selected,
                .draggable-block.is-dragging,
                .draggable-block.is-resizing {
                    border: none !important;
                    outline: none !important;
                    box-shadow: none !important;
                }

                .block-text:focus,
                .block-text.has-overflow {
                    box-shadow: none;
                }
            }
        </style>
    </head>
    <body>
        <div class="preview-toolbar">
            <div class="toolbar-title">จัดจ่าหน้าก่อนพิมพ์: ${preset.label}</div>
            <div class="toolbar-actions">
                <span id="fitStatus" class="fit-status">กำลังตรวจขนาด...</span>
                <label class="edit-toggle"><input id="editModeToggle" type="checkbox"> แก้ไข</label>
                <div class="scale-tools edit-only" aria-label="ปรับภาพรวม">
                    <button class="toolbar-btn" type="button" data-action="font-dec">A-</button>
                    <button class="toolbar-btn" type="button" data-action="font-inc">A+</button>
                    <button class="toolbar-btn" type="button" data-action="from-less">FROM-</button>
                    <button class="toolbar-btn" type="button" data-action="from-more">FROM+</button>
                    <button class="toolbar-btn" type="button" data-action="to-less">TO-</button>
                    <button class="toolbar-btn" type="button" data-action="to-more">TO+</button>
                    <button class="toolbar-btn" type="button" data-action="padding-less">Padding-</button>
                    <button class="toolbar-btn" type="button" data-action="padding-more">Padding+</button>
                    <button class="toolbar-btn" type="button" data-action="spacing-less">Spacing-</button>
                    <button class="toolbar-btn" type="button" data-action="spacing-more">Spacing+</button>
                    <button class="toolbar-btn" type="button" data-action="border-toggle">Border</button>
                    <button class="toolbar-btn" type="button" data-action="reset-print-settings">Reset</button>
                </div>
                <div class="font-tools edit-only" aria-label="ปรับขนาดตัวอักษรเฉพาะกล่อง">
                    <span id="selectedBlockName" class="selected-block-name">ยังไม่ได้เลือกกล่อง</span>
                    <button id="fontDecreaseBtn" class="toolbar-btn" type="button">A-</button>
                    <input id="fontSizeSlider" type="range" min="6" max="46" step="0.5" value="12" disabled>
                    <button id="fontIncreaseBtn" class="toolbar-btn" type="button">A+</button>
                    <span id="fontSizeValue">-</span>
                </div>
                <button id="fitSelectedBtn" class="toolbar-btn edit-only" type="button" disabled>ย่อฟอนต์กล่องนี้</button>
                <button id="refitBtn" class="toolbar-btn edit-only" type="button">Fit</button>
                <button id="applyFirstLayoutBtn" class="toolbar-btn edit-only" type="button">ใช้ layout แผ่นแรกกับทุกแผ่น</button>
                <button id="previewPrintBtn" class="toolbar-btn primary" type="button">พิมพ์</button>
            </div>
        </div>
        <main class="label-sheet">
            ${pagesHTML}
        </main>
    </body>
    </html>
    `;
}

function openPrintPreview(settings = currentPrintSettings) {
    if (receiverList.length === 0) {
        alert("ไม่มีรายชื่อลูกค้าให้พิมพ์ครับ!");
        return;
    }

    saveSenderToAddressBook();

    const normalized = normalizePrintSettings(settings);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("เปิดหน้าต่างพรีวิวไม่ได้ครับ กรุณาอนุญาต popup สำหรับส่วนขยายนี้");
        return;
    }

    const printHTML = buildPrintPreviewHTML(normalized);
    printWindow.document.open();
    printWindow.document.write(printHTML);
    printWindow.document.close();
    installPrintPreviewTools(printWindow, normalized);
}

loadPrintSettings((settings) => {
    syncPrintPresetControls(settings);
});

document.getElementById('printPaperPresetSelect')?.addEventListener('change', (event) => {
    savePrintSettings({ ...currentPrintSettings, paper: event.target.value });
    syncPrintPresetControls(currentPrintSettings);
});

document.getElementById('printLastUsedBtn')?.addEventListener('click', () => {
    openPrintPreviewWithSettings(currentPrintSettings);
});

document.getElementById('printOpenEditorBtn')?.addEventListener('click', () => {
    openPrintPreviewWithSettings(currentPrintSettings);
});

document.getElementById('printBtn')?.addEventListener('click', () => {
    openPrintPreviewWithSettings(currentPrintSettings);
});

// ==========================================
// 🚀 INITIALIZATION ON LOAD
// ==========================================
function switchTab(tab) {
    activeTab = tab;
    const tabSeparateBtn = document.getElementById('tabSeparateBtn');
    const tabCombinedBtn = document.getElementById('tabCombinedBtn');
    const senderZone = document.getElementById('senderZone');
    const receiverZone = document.getElementById('receiverZone');
    const combinedZone = document.getElementById('combinedZone');
    
    if (!tabSeparateBtn || !tabCombinedBtn || !senderZone || !receiverZone || !combinedZone) return;
    
    if (tab === 'separate') {
        tabSeparateBtn.classList.add('active');
        tabCombinedBtn.classList.remove('active');
        senderZone.style.display = 'block';
        receiverZone.style.display = 'block';
        combinedZone.style.display = 'none';
    } else {
        tabCombinedBtn.classList.add('active');
        tabSeparateBtn.classList.remove('active');
        senderZone.style.display = 'none';
        receiverZone.style.display = 'none';
        combinedZone.style.display = 'block';
    }
    saveToCache();
}

document.addEventListener('DOMContentLoaded', () => {
    loadCache();
    setupAutoCache();
    renderHistoryUI();
    renderSenderAddressBook();
    renderSavedReceiverDirectory();

    const receiverDirectorySearch = document.getElementById('receiverDirectorySearch');
    if (receiverDirectorySearch) {
        receiverDirectorySearch.addEventListener('input', renderSavedReceiverDirectory);
    }

    const toggleReceiverDirectoryBtn = document.getElementById('toggleReceiverDirectoryBtn');
    const receiverDirectoryList = document.getElementById('receiverDirectoryList');
    if (toggleReceiverDirectoryBtn && receiverDirectoryList && receiverDirectorySearch) {
        toggleReceiverDirectoryBtn.addEventListener('click', () => {
            if (receiverDirectoryList.style.display === 'none') {
                receiverDirectoryList.style.display = 'flex';
                receiverDirectorySearch.style.display = 'block';
                toggleReceiverDirectoryBtn.innerHTML = '▼ ซ่อน';
            } else {
                receiverDirectoryList.style.display = 'none';
                receiverDirectorySearch.style.display = 'none';
                toggleReceiverDirectoryBtn.innerHTML = '▶ แสดง';
            }
        });
    }

    const senderAddressBookSearch = document.getElementById('senderAddressBookSearch');
    if (senderAddressBookSearch) {
        senderAddressBookSearch.addEventListener('input', renderSenderAddressBook);
    }

    const senderAddressBookSearchReview = document.getElementById('senderAddressBookSearchReview');
    if (senderAddressBookSearchReview) {
        senderAddressBookSearchReview.addEventListener('input', renderSenderAddressBook);
    }
    
    const tabSeparateBtn = document.getElementById('tabSeparateBtn');
    const tabCombinedBtn = document.getElementById('tabCombinedBtn');
    if (tabSeparateBtn && tabCombinedBtn) {
        tabSeparateBtn.addEventListener('click', () => switchTab('separate'));
        tabCombinedBtn.addEventListener('click', () => switchTab('combined'));
    }
    
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm("แน่ใจหรือไม่ว่าต้องการลบประวัติทั้งหมด?")) {
                clearHistory();
            }
        });
    }
    
    const validateSenderBtn = document.getElementById('validateSenderBtn');
    if (validateSenderBtn) {
        validateSenderBtn.addEventListener('click', async () => {
            const resultDiv = document.getElementById('validateSenderResult');
            
            if (resultDiv.style.display === 'block') {
                resultDiv.style.display = 'none';
                return;
            }
            
            resultDiv.style.display = 'block';
            resultDiv.style.background = '#eff6ff';
            resultDiv.style.border = '1px solid #bfdbfe';
            resultDiv.style.color = '#1e40af';
            resultDiv.innerHTML = '⏳ กำลังตรวจสอบ...';
            
            await initDatabases();
            
            const result = validateSenderAddress();
            
            if (result) {
                resultDiv.innerHTML = result.message;
                
                if (result.status === 'correct') {
                    resultDiv.style.background = '#dcfce7';
                    resultDiv.style.border = '1px solid #86efac';
                    resultDiv.style.color = '#166534';
                } else if (result.status === 'warning') {
                    resultDiv.style.background = '#fef3c7';
                    resultDiv.style.border = '1px solid #fcd34d';
                    resultDiv.style.color = '#92400e';
                } else if (result.status === 'wrong') {
                    resultDiv.style.background = '#fee2e2';
                    resultDiv.style.border = '1px solid #fca5a5';
                    resultDiv.style.color = '#991b1b';
                } else {
                    resultDiv.style.background = '#f1f5f9';
                    resultDiv.style.border = '1px solid #cbd5e1';
                    resultDiv.style.color = '#475569';
                }
            }
        });
    }
    
    const toggleBtnInput = document.getElementById('toggleAddressBookBtn');
    const addressBookListInput = document.getElementById('addressBookList');
    
    if (toggleBtnInput && addressBookListInput) {
        toggleBtnInput.addEventListener('click', () => {
            if (addressBookListInput.style.display === 'none') {
                addressBookListInput.style.display = 'flex';
                const senderAddressBookSearch = document.getElementById('senderAddressBookSearch');
                if (senderAddressBookSearch) senderAddressBookSearch.style.display = 'block';
                toggleBtnInput.innerHTML = '▼ ซ่อน';
            } else {
                addressBookListInput.style.display = 'none';
                const senderAddressBookSearch = document.getElementById('senderAddressBookSearch');
                if (senderAddressBookSearch) senderAddressBookSearch.style.display = 'none';
                toggleBtnInput.innerHTML = '▶ แสดง';
            }
        });
    }
    
    const toggleBtnReview = document.getElementById('toggleAddressBookBtnReview');
    const addressBookListReview = document.getElementById('addressBookListReview');
    
    if (toggleBtnReview && addressBookListReview) {
        toggleBtnReview.addEventListener('click', () => {
            if (addressBookListReview.style.display === 'none') {
                addressBookListReview.style.display = 'flex';
                const senderAddressBookSearchReview = document.getElementById('senderAddressBookSearchReview');
                if (senderAddressBookSearchReview) senderAddressBookSearchReview.style.display = 'block';
                toggleBtnReview.innerHTML = '▼ ซ่อน';
            } else {
                addressBookListReview.style.display = 'none';
                const senderAddressBookSearchReview = document.getElementById('senderAddressBookSearchReview');
                if (senderAddressBookSearchReview) senderAddressBookSearchReview.style.display = 'none';
                toggleBtnReview.innerHTML = '▶ แสดง';
            }
        });
    }
});

