/************************************************************
 * BD CRM v2.0
 * Code.gs
 *
 * 기준 파일
 * - index.html / js.html 기존 구조 유지
 * - CRMAnalysisService(crm.gs) 기존 로직 사용
 *
 * 핵심 수정
 * 1) js.html에서 호출하는 서버 함수명 복구
 *    - getDashboardInfo()
 *    - runBDCRM()
 *    - getSheetPreview()
 *    - getDailyConversionTrendPreview()
 *    - importUploadedOrders()
 *    - runRepurchaseDetail()
 *    - runCrossSellDetail()
 *    - searchCustomerSummaryById()
 *    - searchCustomerProductById()
 *
 * 2) 결과 시트 초기화는 clearContents()가 아니라 sheet.clear()
 *    - 기존 % 서식 잔존으로 추가구매수/이탈수가 800%, 1900%처럼 보이는 문제 방지
 ************************************************************/


/************************************************************
 * CONFIG
 ************************************************************/

var BD_CRM_CONFIG = {
  SHEETS: {
    UPLOAD: '원본_업로드',
    DB: '원본_DB',
    CONFIG: 'CONFIG',
    LOG: '실행_LOG',

    DASHBOARD: '전체 요약 리포트',
    PRODUCT_SUMMARY: '상품별 통합 통계',
    DAILY_CONVERSION: '일자별 전환 흐름',

    REPURCHASE_DETAIL: '재구매 대상자',
    CROSS_SELL_DETAIL: '추가구매 대상자',
    CROSS_SELL_MATRIX: '상품 이동 전환 Matrix',

    CAMPAIGN: '캠페인 관리',
    CAMPAIGN_PERFORMANCE: '캠페인 성과 분석'
  },

  HEADERS: {
    ORDER_DATE: '주문일',
    MEMBER_ID: '주문자ID',
    PRODUCT_NAME: '상품명(한국어 쇼핑몰)',
    OPTION: '상품옵션',
    QUANTITY: '수량',
    SEQUENCE: '주문순번',
    AMOUNT: '총 결제금액'
  },

  PRODUCT_HEADERS: [
    '애사비',
    '레몬즙',
    '올리브오일',
    '컬리케일',
    '알부민',
    '포스파티딜세린',
    '쾌변습관',
    '블랙마카',
    '침향송침유',
    '진생바이타'
  ],

  PREVIEW_LIMIT: 500,

  DEFAULT_DECISION_DAYS: 100,

  PRODUCT_DECISION_DAYS: {
    '애사비': 100,
    '레몬즙': 100,
    '올리브오일': 100,
    '컬리케일': 100,
    '알부민': 100,
    '포스파티딜세린': 50,
    '쾌변습관': 50,
    '블랙마카': 100,
    '침향송침유': 100,
    '진생바이타': 100
  }
};


/************************************************************
 * WEB APP
 ************************************************************/

function doGet(e) {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('BD CRM v2.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/************************************************************
 * SERVICE FACTORY
 ************************************************************/

function getCRMService_() {
  if (typeof CRMAnalysisService !== 'function') {
    throw new Error('CRMAnalysisService를 찾을 수 없습니다. crm.gs 파일이 프로젝트에 있는지 확인해주세요.');
  }

  return new CRMAnalysisService(BD_CRM_CONFIG);
}


/************************************************************
 * js.html에서 호출하는 서버 함수
 ************************************************************/

/**
 * 상단 대시보드 지표 조회
 * js.html → getDashboardInfo()
 */
function getDashboardInfo() {
  var perfStart = Date.now();
  var dashboardMap = readKeyValueSheet_(BD_CRM_CONFIG.SHEETS.DASHBOARD);
  Logger.log('[PERF] getDashboardInfo: readKeyValueSheet_(DASHBOARD) ' + (Date.now() - perfStart) + 'ms, empty=' + (!dashboardMap || Object.keys(dashboardMap).length === 0));

  if (!dashboardMap || Object.keys(dashboardMap).length === 0) {
    try {
      var t = Date.now();
      getCRMService_().buildDashboard();
      Logger.log('[PERF] getDashboardInfo: fallback buildDashboard ' + (Date.now() - t) + 'ms');
      dashboardMap = readKeyValueSheet_(BD_CRM_CONFIG.SHEETS.DASHBOARD);
    } catch (error) {
      dashboardMap = {};
    }
  }

  var configMap = readKeyValueSheet_(BD_CRM_CONFIG.SHEETS.CONFIG);

  var t2 = Date.now();
  var cachedStart = configMap['집계기간_시작일'] || configMap['집계기간시작일'];
  var cachedEnd = configMap['집계기간_종료일'] || configMap['집계기간종료일'];
  var aggregationPeriod;

  if (cachedStart && cachedEnd) {
    aggregationPeriod = {
      startDate: cachedStart,
      endDate: cachedEnd,
      label: cachedStart + ' ~ ' + cachedEnd
    };
  } else {
    aggregationPeriod = getOrderDateRange_();
  }

  Logger.log('[PERF] getDashboardInfo: aggregationPeriod ' + (Date.now() - t2) + 'ms, fromCache=' + !!(cachedStart && cachedEnd));
  Logger.log('[PERF] getDashboardInfo TOTAL ' + (Date.now() - perfStart) + 'ms');

  return {
    member: toNumber_(dashboardMap['총 회원수'] || dashboardMap['총회원수']),
    memberCount: toNumber_(dashboardMap['총 회원수'] || dashboardMap['총회원수']),
    totalMember: toNumber_(dashboardMap['총 회원수'] || dashboardMap['총회원수']),
    totalMembers: toNumber_(dashboardMap['총 회원수'] || dashboardMap['총회원수']),

    order: toNumber_(dashboardMap['총 주문건수'] || dashboardMap['총주문건수']),
    orderCount: toNumber_(dashboardMap['총 주문건수'] || dashboardMap['총주문건수']),
    totalOrder: toNumber_(dashboardMap['총 주문건수'] || dashboardMap['총주문건수']),
    totalOrders: toNumber_(dashboardMap['총 주문건수'] || dashboardMap['총주문건수']),

    product: toNumber_(dashboardMap['상품수'] || dashboardMap['관리 상품수'] || dashboardMap['관리상품수']),
    productCount: toNumber_(dashboardMap['상품수'] || dashboardMap['관리 상품수'] || dashboardMap['관리상품수']),

    repurchase: toNumber_(dashboardMap['재구매 회원수'] || dashboardMap['재구매회원수']),
    repurchaseCount: toNumber_(dashboardMap['재구매 회원수'] || dashboardMap['재구매회원수']),
    repurchaseMemberCount: toNumber_(dashboardMap['재구매 회원수'] || dashboardMap['재구매회원수']),

    crossSell: toNumber_(dashboardMap['추가구매 회원수'] || dashboardMap['추가구매회원수']),
    crossSellCount: toNumber_(dashboardMap['추가구매 회원수'] || dashboardMap['추가구매회원수']),
    crossSellMemberCount: toNumber_(dashboardMap['추가구매 회원수'] || dashboardMap['추가구매회원수']),


    aggregationPeriod: aggregationPeriod.label,
    aggregationStartDate: aggregationPeriod.startDate,
    aggregationEndDate: aggregationPeriod.endDate,
    '집계기간': aggregationPeriod.label,

    // 기존 js 호환용: 화면에서는 '집계기간'으로 표시함
    latestOrderDate: aggregationPeriod.label,
    latestOrder: aggregationPeriod.label,
    '반영된 최신 주문일': aggregationPeriod.label,

    lastImportedAt: configMap['최종 DB 반영시간'] || configMap['최종DB반영시간'] || '',
    lastImportAt: configMap['최종 DB 반영시간'] || configMap['최종DB반영시간'] || '',
    '최종 DB 반영시간': configMap['최종 DB 반영시간'] || configMap['최종DB반영시간'] || ''
  };
}


/**
 * 원본_업로드 → 원본_DB 반영
 * js.html → importUploadedOrders()
 */
function importUploadedOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var uploadSheet = getOrCreateSheet_(BD_CRM_CONFIG.SHEETS.UPLOAD);
  var dbSheet = getOrCreateSheet_(BD_CRM_CONFIG.SHEETS.DB);

  var uploadLastRow = uploadSheet.getLastRow();
  var uploadLastColumn = uploadSheet.getLastColumn();

  if (uploadLastRow < 2 || uploadLastColumn < 1) {
    return {
      ok: true,
      message: '반영할 원본_업로드 데이터가 없습니다.',
      importedCount: 0,
      dashboard: getDashboardInfo()
    };
  }

  var uploadValues = uploadSheet.getRange(1, 1, uploadLastRow, uploadLastColumn).getValues();
  var uploadHeader = uploadValues[0];
  var uploadBody = uploadValues.slice(1).filter(function (row) {
    return !isEmptyRow_(row);
  });

  if (!uploadBody.length) {
    return {
      ok: true,
      message: '반영할 원본_업로드 데이터가 없습니다.',
      importedCount: 0,
      dashboard: getDashboardInfo()
    };
  }

  if (dbSheet.getLastRow() < 1) {
    dbSheet.getRange(1, 1, 1, uploadHeader.length).setValues([uploadHeader]);
    dbSheet.setFrozenRows(1);
  }

  var dbLastColumn = Math.max(dbSheet.getLastColumn(), uploadHeader.length);

  if (dbSheet.getLastRow() < 1 || dbSheet.getRange(1, 1).getValue() === '') {
    dbSheet.getRange(1, 1, 1, uploadHeader.length).setValues([uploadHeader]);
  }

  var normalizedBody = uploadBody.map(function (row) {
    var newRow = row.slice();

    while (newRow.length < dbLastColumn) {
      newRow.push('');
    }

    return newRow.slice(0, dbLastColumn);
  });

  dbSheet
    .getRange(dbSheet.getLastRow() + 1, 1, normalizedBody.length, dbLastColumn)
    .setValues(normalizedBody);

  uploadSheet
    .getRange(2, 1, uploadLastRow - 1, uploadLastColumn)
    .clearContent();

  writeConfigValue_('최종 DB 반영시간', formatDateTime_(new Date()));

  var dashboard = getDashboardInfo();

  writeRunLog_('SUCCESS', 'importUploadedOrders', normalizedBody.length + '건 반영');

  return {
    ok: true,
    message: '원본 데이터 ' + normalizedBody.length + '건을 원본_DB에 반영했습니다.',
    importedCount: normalizedBody.length,
    dashboard: dashboard
  };
}


/**
 * 전체 CRM 분석 실행
 * js.html → runBDCRM()
 */
function runBDCRM() {
  var startedAt = new Date();
  var t0 = Date.now();

  try {
    var service = getCRMService_();

    Logger.log('[PERF] getRecords_ start');
    var t1 = Date.now();
    service.getRecords_();
    Logger.log('[PERF] getRecords_ ' + (Date.now() - t1) + 'ms');

    var t2 = Date.now();
    service.buildDashboard();
    Logger.log('[PERF] buildDashboard ' + (Date.now() - t2) + 'ms');

    var t3 = Date.now();
    service.buildProductSummary();
    Logger.log('[PERF] buildProductSummary ' + (Date.now() - t3) + 'ms');

    var t5 = Date.now();
    service.buildCrossSellMatrix();
    Logger.log('[PERF] buildCrossSellMatrix ' + (Date.now() - t5) + 'ms');

    var t6 = Date.now();
    service.buildDailyConversionTrend();
    Logger.log('[PERF] buildDailyConversionTrend ' + (Date.now() - t6) + 'ms');

    var t7 = Date.now();
    applyAllReportFormats_();
    Logger.log('[PERF] applyAllReportFormats_ ' + (Date.now() - t7) + 'ms');

    var t7b = Date.now();
    var orderDateRange = service.getOrderDateRangeFromRecords_();
    writeConfigValue_('집계기간_시작일', orderDateRange.startDate);
    writeConfigValue_('집계기간_종료일', orderDateRange.endDate);
    Logger.log('[PERF] cache orderDateRange ' + (Date.now() - t7b) + 'ms');

    var t8 = Date.now();
    var dashboard = getDashboardInfo();
    Logger.log('[PERF] getDashboardInfo ' + (Date.now() - t8) + 'ms');

    Logger.log('[PERF] runBDCRM TOTAL ' + (Date.now() - t0) + 'ms');

    writeRunLog_('SUCCESS', 'runBDCRM', '전체 CRM 분석 완료', startedAt, new Date());

    return dashboard;

  } catch (error) {
    writeRunLog_('ERROR', 'runBDCRM', error && error.message ? error.message : String(error), startedAt, new Date());
    throw error;
  }
}


/**
 * 리포트 미리보기
 * js.html → getSheetPreview(outputKey, title)
 */
function getSheetPreview(outputKey, title) {
  var sheetName = resolveSheetName_(outputKey, title);
  var rows = readSheetDisplayRows_(sheetName);
  var total = Math.max(rows.length - 1, 0);
  var limit = BD_CRM_CONFIG.PREVIEW_LIMIT;
  var shown = Math.min(total, limit);

  return {
    ok: true,
    title: title || sheetName,
    sheetName: sheetName,
    total: total,
    shown: shown,
    limit: limit,
    truncated: total > shown,
    rows: rows.slice(0, shown + 1)
  };
}


/**
 * 일자별 전환 흐름 기간 조회
 * js.html → getDailyConversionTrendPreview(startDate, endDate)
 */
function getDailyConversionTrendPreview(startDate, endDate, mode) {
  var sheetName = BD_CRM_CONFIG.SHEETS.DAILY_CONVERSION;
  var selectedMode = String(mode || 'PURCHASE_DATE').toUpperCase();

  if (selectedMode !== 'DUE_DATE') {
    selectedMode = 'PURCHASE_DATE';
  }

  var perfStart = Date.now();
  var rows = getCRMService_().buildDailyConversionTrend(selectedMode);
  Logger.log('[PERF] getDailyConversionTrendPreview(' + selectedMode + ') buildDailyConversionTrend ' + (Date.now() - perfStart) + 'ms');
  var dailySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);

  if (dailySheet) {
    applyReportFormat_(dailySheet);
  }

  if (!rows || !rows.length) {
    if (selectedMode === 'DUE_DATE') {
      rows = [[
        '판정일',
        '판정대상수',
        '판정완료대상수',
        '재구매완료',
        '재구매율',
        '추가구매만',
        '추가구매율',
        '미구매',
        '미구매율',
        '판정대기',
        '판정대기율'
      ]];
    } else {
      rows = [[
        '구매일',
        '구매고객수',
        '첫구매',
        '첫구매율',
        '재구매만',
        '재구매만율',
        '추가구매만',
        '추가구매만율',
        '재구매+추가구매',
        '재구매+추가구매율'
      ]];
    }
  }

  var header = rows[0] || [];
  var dateIndex = findHeaderIndex_(header, ['구매일', '판정일', '일자', '날짜']);

  var start = parseDateOnly_(startDate);
  var end = parseDateOnly_(endDate);

  var filtered = rows.slice(1).filter(function (row) {
    if (dateIndex < 0) {
      return true;
    }

    var rowDate = parseDateOnly_(row[dateIndex]);

    if (!rowDate) {
      return false;
    }

    if (start && rowDate.getTime() < start.getTime()) {
      return false;
    }

    if (end && rowDate.getTime() > end.getTime()) {
      return false;
    }

    return true;
  });

  var resultRows = [header].concat(filtered);
  var total = Math.max(resultRows.length - 1, 0);

  var title = selectedMode === 'DUE_DATE'
    ? '재구매 도래일 기준 회수 / 이탈 흐름'
    : '구매일 기준 고객 구매유형 흐름';

  var note = selectedMode === 'DUE_DATE'
    ? '판정일은 기존 구매일 + 상품별 기준일수입니다. 해당 날짜가 재구매 도래일인 고객/상품을 기준으로 재구매완료, 추가구매만, 미구매, 판정대기를 집계합니다.'
    : '구매일은 실제 주문일입니다. 해당 날짜에 구매한 고객을 첫구매, 재구매만, 추가구매만, 재구매+추가구매로 중복 없이 분류합니다.';

  return {
    ok: true,
    title: title,
    sheetName: sheetName,
    chartType: 'dailyOutcomeTrend',
    mode: selectedMode,
    startDate: startDate || '',
    endDate: endDate || '',
    total: total,
    shown: total,
    limit: total,
    truncated: false,
    rows: resultRows,
    note: note
  };
}


/**
 * 재구매 대상자 조회
 * js.html → runRepurchaseDetail(productName, minDays)
 */
function runRepurchaseDetail(productName, minDays) {
  return getCRMService_().buildRepurchaseDetail(productName, minDays);
}


/**
 * 추가구매 대상자 조회
 * js.html → runCrossSellDetail(productName)
 */
function runCrossSellDetail(productName) {
  return getCRMService_().buildCrossSellDetail(productName);
}


/**
 * 상품 이동 전환 Matrix 생성/조회
 * js.html → runCrossSellMatrix()
 */
function runCrossSellMatrix() {
  var rows = getCRMService_().buildCrossSellMatrix();
  applyAllReportFormats_();

  return getSheetPreview('CROSS_SELL_MATRIX', '상품 이동 전환 Matrix');
}


/**
 * 고객별 구매 내역
 * js.html → searchCustomerSummaryById(customerId)
 */
function searchCustomerSummaryById(customerId) {
  return getCRMService_().searchCustomerSummaryById(customerId);
}


/**
 * 고객×상품 구매 내역
 * js.html → searchCustomerProductById(customerId)
 */
function searchCustomerProductById(customerId) {
  return getCRMService_().searchCustomerProductById(customerId);
}


/************************************************************
 * 호환용 alias
 ************************************************************/

function runCRM() {
  return runBDCRM();
}

function runAllReports() {
  return runBDCRM();
}

function buildCRM() {
  return runBDCRM();
}

function getDashboardData() {
  return {
    ok: true,
    summary: getSheetPreview('DASHBOARD', '전체 요약 리포트'),
    productSummary: getSheetPreview('PRODUCT_SUMMARY', '상품별 통합 통계'),
    movementMatrix: getSheetPreview('CROSS_SELL_MATRIX', '상품 이동 전환 Matrix'),
    dailyFlow: getSheetPreview('DAILY_CONVERSION', '일자별 전환 흐름')
  };
}

function getInitialData() {
  return getDashboardData();
}

function getAppData() {
  return getDashboardData();
}

function getDailyConversionFlowData() {
  return getSheetPreview('DAILY_CONVERSION', '일자별 전환 흐름');
}

function getDailyFlowData() {
  return getDailyConversionFlowData();
}


/************************************************************
 * 캠페인 관리
 * - 기존 화면 버튼 오류 방지용 기본 구현
 ************************************************************/

function saveCampaign(campaign) {
  campaign = campaign || {};

  var sheet = getOrCreateSheet_(BD_CRM_CONFIG.SHEETS.CAMPAIGN);
  var headers = [
    '캠페인ID',
    '차수',
    '캠페인명',
    '시작일',
    '종료일',
    '대상상품',
    '목표',
    '코멘트',
    '저장일시'
  ];

  ensureHeader_(sheet, headers);

  var campaignId = campaign.campaignId || ('CP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss'));

  sheet.appendRow([
    campaignId,
    campaign.round || '',
    campaign.name || '',
    campaign.startDate || '',
    campaign.endDate || '',
    campaign.product || '전체',
    campaign.goal || '',
    campaign.comment || '',
    formatDateTime_(new Date())
  ]);

  return {
    ok: true,
    message: '캠페인을 저장했습니다.',
    campaignId: campaignId,
    list: getCampaignList()
  };
}


function getCampaignList() {
  return getSheetPreview('CAMPAIGN', '캠페인 목록');
}


function runCampaignPerformanceAnalysis() {
  var campaignRows = readSheetDisplayRows_(BD_CRM_CONFIG.SHEETS.CAMPAIGN);
  var rows = [[
    '캠페인ID',
    '차수',
    '캠페인명',
    '시작일',
    '종료일',
    '대상상품',
    '목표',
    '코멘트',
    '비고'
  ]];

  if (campaignRows.length > 1) {
    campaignRows.slice(1).forEach(function (row) {
      rows.push([
        row[0] || '',
        row[1] || '',
        row[2] || '',
        row[3] || '',
        row[4] || '',
        row[5] || '',
        row[6] || '',
        row[7] || '',
        '성과 분석 로직은 캠페인 기준 정의 후 확장 필요'
      ]);
    });
  }

  writeSheet_(BD_CRM_CONFIG.SHEETS.CAMPAIGN_PERFORMANCE, rows);

  return getCampaignPerformancePreview();
}


function getCampaignPerformancePreview() {
  return getSheetPreview('CAMPAIGN_PERFORMANCE', '캠페인 성과 분석');
}


/************************************************************
 * 공통 시트 유틸
 ************************************************************/

function resolveSheetName_(outputKey, title) {
  var key = String(outputKey || '').trim();

  var map = {
    UPLOAD: BD_CRM_CONFIG.SHEETS.UPLOAD,
    DB: BD_CRM_CONFIG.SHEETS.DB,
    CONFIG: BD_CRM_CONFIG.SHEETS.CONFIG,
    DASHBOARD: BD_CRM_CONFIG.SHEETS.DASHBOARD,
    PRODUCT_SUMMARY: BD_CRM_CONFIG.SHEETS.PRODUCT_SUMMARY,
    DAILY_CONVERSION: BD_CRM_CONFIG.SHEETS.DAILY_CONVERSION,
    REPURCHASE_DETAIL: BD_CRM_CONFIG.SHEETS.REPURCHASE_DETAIL,
    CROSS_SELL_DETAIL: BD_CRM_CONFIG.SHEETS.CROSS_SELL_DETAIL,
    CROSS_SELL_MATRIX: BD_CRM_CONFIG.SHEETS.CROSS_SELL_MATRIX,
    CAMPAIGN: BD_CRM_CONFIG.SHEETS.CAMPAIGN,
    CAMPAIGN_PERFORMANCE: BD_CRM_CONFIG.SHEETS.CAMPAIGN_PERFORMANCE
  };

  if (map[key]) {
    return map[key];
  }

  if (title) {
    return title;
  }

  return key;
}


function getOrCreateSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  return sheet;
}


/**
 * 결과 시트 초기화
 * clearContents() 금지: 기존 % 서식이 남으면 숫자 컬럼이 퍼센트로 보임
 */
function resetSheet_(sheetName) {
  var sheet = getOrCreateSheet_(sheetName);
  var filter = sheet.getFilter();

  if (filter) {
    filter.remove();
  }

  sheet.clear();
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);

  var maxRows = sheet.getMaxRows();
  var maxColumns = sheet.getMaxColumns();

  if (maxRows > 0) {
    sheet.showRows(1, maxRows);
  }

  if (maxColumns > 0) {
    sheet.showColumns(1, maxColumns);
  }

  return sheet;
}


/**
 * CRMAnalysisService에서 호출하는 전역 함수
 */
function writeSheet_(sheetName, values) {
  var sheet = resetSheet_(sheetName);
  values = values || [];

  if (!values.length) {
    return sheet;
  }

  var maxColumns = values.reduce(function (max, row) {
    return Math.max(max, row.length);
  }, 0);

  var normalized = values.map(function (row) {
    var newRow = row.slice();

    while (newRow.length < maxColumns) {
      newRow.push('');
    }

    return newRow;
  });

  sheet
    .getRange(1, 1, normalized.length, maxColumns)
    .setValues(normalized);

  sheet.setFrozenRows(1);

  sheet
    .getRange(1, 1, 1, maxColumns)
    .setFontWeight('bold')
    .setBackground('#eef4fa');

  applyReportFormat_(sheet);

  return sheet;
}


function applyAllReportFormats_() {
  [
    BD_CRM_CONFIG.SHEETS.DASHBOARD,
    BD_CRM_CONFIG.SHEETS.PRODUCT_SUMMARY,
    BD_CRM_CONFIG.SHEETS.CROSS_SELL_MATRIX,
    BD_CRM_CONFIG.SHEETS.DAILY_CONVERSION,
    BD_CRM_CONFIG.SHEETS.REPURCHASE_DETAIL,
    BD_CRM_CONFIG.SHEETS.CROSS_SELL_DETAIL
  ].forEach(function (sheetName) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);

    if (sheet) {
      applyReportFormat_(sheet);
    }
  });
}


function applyReportFormat_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    return;
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];

  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c] || '').replace(/\s/g, '');
    var col = c + 1;

    if (lastRow >= 2) {
      var bodyRange = sheet.getRange(2, col, lastRow - 1, 1);

      if (
        header === '주문일' ||
        header === '판정일' ||
        header.indexOf('날짜') > -1 ||
        header.indexOf('구매일') > -1 ||
        header.indexOf('시작일') > -1 ||
        header.indexOf('종료일') > -1
      ) {
        bodyRange.setNumberFormat('yyyy-mm-dd');
      } else if (
        header.indexOf('율') > -1 ||
        header.indexOf('비율') > -1
      ) {
        // 현재 CRMAnalysisService는 formatRate_()로 문자열 "00.0%"를 쓰므로
        // 이 서식은 숫자 비율이 들어왔을 때만 보조 역할을 함.
        // 건수/수량/고객수 컬럼에는 절대 퍼센트 서식을 적용하지 않음.
        bodyRange.setNumberFormat('@');
      } else if (
        header.indexOf('수') > -1 ||
        header.indexOf('건') > -1 ||
        header.indexOf('명') > -1 ||
        header.indexOf('금액') > -1 ||
        header.indexOf('소요일') > -1 ||
        header.indexOf('경과일') > -1 ||
        header === '첫구매' ||
        header === '재구매만' ||
        header === '추가구매만' ||
        header === '재구매완료' ||
        header === '미구매' ||
        header === '판정대기' ||
        header === '재구매+추가구매'
      ) {
        bodyRange.setNumberFormat('#,##0');
      } else {
        bodyRange.setNumberFormat('@');
      }
    }
  }

  try {
    sheet.autoResizeColumns(1, lastColumn);
  } catch (error) {}
}


function readSheetDisplayRows_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return [];
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    return [];
  }

  return sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
}


function readKeyValueSheet_(sheetName) {
  var rows = readSheetDisplayRows_(sheetName);
  var map = {};

  rows.slice(1).forEach(function (row) {
    if (!row || row.length < 2) {
      return;
    }

    var key = String(row[0] || '').trim();

    if (!key) {
      return;
    }

    map[key] = row[1];
    map[key.replace(/\s/g, '')] = row[1];
  });

  return map;
}


function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
  var hasAnyHeader = current.some(function (value) {
    return String(value || '').trim() !== '';
  });

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}


function writeConfigValue_(key, value) {
  var sheet = getOrCreateSheet_(BD_CRM_CONFIG.SHEETS.CONFIG);

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 2).setValues([['항목', '값']]);
    sheet.setFrozenRows(1);
  }

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(1, 1, lastRow, 2).getValues();

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value]);
}


function getOrderDateRange_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BD_CRM_CONFIG.SHEETS.DB);

  if (!sheet || sheet.getLastRow() < 2) {
    return {
      startDate: '',
      endDate: '',
      label: '-'
    };
  }

  var lastColumn = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(String);
  var dateIndex = header.indexOf(BD_CRM_CONFIG.HEADERS.ORDER_DATE);

  if (dateIndex < 0) {
    return {
      startDate: '',
      endDate: '',
      label: '-'
    };
  }

  var lastRow = sheet.getLastRow();
  var dateValues = sheet.getRange(2, dateIndex + 1, lastRow - 1, 1).getValues();
  var earliest = null;
  var latest = null;

  for (var i = 0; i < dateValues.length; i++) {
    var date = toDateValue_(dateValues[i][0]);

    if (!date) {
      continue;
    }

    if (!earliest || date.getTime() < earliest.getTime()) {
      earliest = date;
    }

    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }

  var startDate = earliest ? formatDate_(earliest) : '';
  var endDate = latest ? formatDate_(latest) : '';

  return {
    startDate: startDate,
    endDate: endDate,
    label: startDate && endDate ? startDate + ' ~ ' + endDate : '-'
  };
}


function getLatestOrderDate_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BD_CRM_CONFIG.SHEETS.DB);

  if (!sheet || sheet.getLastRow() < 2) {
    return '';
  }

  var lastColumn = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(String);
  var dateIndex = header.indexOf(BD_CRM_CONFIG.HEADERS.ORDER_DATE);

  if (dateIndex < 0) {
    return '';
  }

  // 속도 개선:
  // 기존에는 원본_DB 전체 범위를 getDataRange()로 읽어 매번 느려질 수 있었음.
  // 최신 주문일 계산에는 주문일 컬럼만 필요하므로 해당 컬럼만 조회한다.
  var lastRow = sheet.getLastRow();
  var dateValues = sheet.getRange(2, dateIndex + 1, lastRow - 1, 1).getValues();
  var latest = null;

  for (var i = 0; i < dateValues.length; i++) {
    var date = toDateValue_(dateValues[i][0]);

    if (!date) {
      continue;
    }

    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }

  return latest ? formatDate_(latest) : '';
}


function findHeaderIndex_(header, candidates) {
  var normalizedCandidates = candidates.map(function (candidate) {
    return String(candidate || '').replace(/\s/g, '').toLowerCase();
  });

  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || '').replace(/\s/g, '').toLowerCase();

    for (var j = 0; j < normalizedCandidates.length; j++) {
      if (h === normalizedCandidates[j] || h.indexOf(normalizedCandidates[j]) > -1) {
        return i;
      }
    }
  }

  return -1;
}


function isEmptyRow_(row) {
  return row.every(function (value) {
    return value === '' || value === null || value === undefined;
  });
}


/************************************************************
 * CRMAnalysisService 공통 헬퍼
 ************************************************************/

function toNumber_(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  var text = String(value)
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/％/g, '')
    .trim();

  if (text === '') {
    return 0;
  }

  var num = Number(text);

  return isNaN(num) ? 0 : num;
}


function toDateValue_(value) {
  if (!value) {
    return null;
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number') {
    var dateFromSerial = new Date(Math.round((value - 25569) * 86400 * 1000));
    return isNaN(dateFromSerial.getTime()) ? null : dateFromSerial;
  }

  var text = String(value).trim();

  if (!text) {
    return null;
  }

  var normalized = text.replace(/[.]/g, '-').replace(/\//g, '-');
  var match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (match) {
    var yyyy = Number(match[1]);
    var mm = Number(match[2]);
    var dd = Number(match[3]);
    var date = new Date(yyyy, mm - 1, dd);

    return isNaN(date.getTime()) ? null : date;
  }

  var parsed = new Date(text);

  return isNaN(parsed.getTime()) ? null : parsed;
}


function normalizeDateOnly_(value) {
  var date = toDateValue_(value);

  if (!date) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}


function parseDateOnly_(value) {
  return normalizeDateOnly_(value);
}


function addDays_(date, days) {
  var base = normalizeDateOnly_(date);

  if (!base) {
    return null;
  }

  var result = new Date(base);
  result.setDate(result.getDate() + Number(days || 0));

  return normalizeDateOnly_(result);
}


function daysBetween_(startDate, endDate) {
  var start = normalizeDateOnly_(startDate);
  var end = normalizeDateOnly_(endDate);

  if (!start || !end) {
    return '';
  }

  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}


var SCRIPT_TIME_ZONE_CACHE_ = null;

function getScriptTimeZone_() {
  if (!SCRIPT_TIME_ZONE_CACHE_) {
    SCRIPT_TIME_ZONE_CACHE_ = Session.getScriptTimeZone();
  }

  return SCRIPT_TIME_ZONE_CACHE_;
}

var FORMAT_DATE_CACHE_ = {};

function formatDate_(value) {
  var date = normalizeDateOnly_(value);

  if (!date) {
    return '';
  }

  var cacheKey = date.getTime();

  if (FORMAT_DATE_CACHE_[cacheKey] === undefined) {
    FORMAT_DATE_CACHE_[cacheKey] = Utilities.formatDate(date, getScriptTimeZone_(), 'yyyy-MM-dd');
  }

  return FORMAT_DATE_CACHE_[cacheKey];
}


function formatDateTime_(value) {
  var date = toDateValue_(value) || new Date();

  return Utilities.formatDate(date, getScriptTimeZone_(), 'yyyy-MM-dd HH:mm:ss');
}


function formatRate_(value) {
  var num = toNumber_(value);
  var rounded = Math.round(num * 10) / 10;

  if (rounded % 1 === 0) {
    return String(rounded) + '%';
  }

  return rounded.toFixed(1) + '%';
}


/************************************************************
 * 실행 로그 / 점검
 ************************************************************/

function writeRunLog_(status, action, message, startedAt, endedAt) {
  try {
    var sheet = getOrCreateSheet_(BD_CRM_CONFIG.SHEETS.LOG);

    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, 6).setValues([[
        '실행일시',
        '상태',
        '실행항목',
        '메시지',
        '시작시간',
        '종료시간'
      ]]);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      status || '',
      action || '',
      message || '',
      startedAt || '',
      endedAt || ''
    ]);
  } catch (error) {}
}


function checkCRMStatus() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheetNames = [
    BD_CRM_CONFIG.SHEETS.UPLOAD,
    BD_CRM_CONFIG.SHEETS.DB,
    BD_CRM_CONFIG.SHEETS.CONFIG,
    BD_CRM_CONFIG.SHEETS.LOG,
    BD_CRM_CONFIG.SHEETS.DASHBOARD,
    BD_CRM_CONFIG.SHEETS.PRODUCT_SUMMARY,
    BD_CRM_CONFIG.SHEETS.CROSS_SELL_MATRIX,
    BD_CRM_CONFIG.SHEETS.DAILY_CONVERSION
  ];

  return {
    ok: true,
    spreadsheetName: ss.getName(),
    checkedAt: new Date().toISOString(),
    sheets: sheetNames.map(function (name) {
      var sheet = ss.getSheetByName(name);

      return {
        sheetName: name,
        exists: !!sheet,
        lastRow: sheet ? sheet.getLastRow() : 0,
        lastColumn: sheet ? sheet.getLastColumn() : 0
      };
    })
  };
}


function debugCRMDataLink() {
  return {
    ok: true,
    dashboardInfo: getDashboardInfo(),
    dashboardPreview: getSheetPreview('DASHBOARD', '전체 요약 리포트'),
    productSummaryPreview: getSheetPreview('PRODUCT_SUMMARY', '상품별 통합 통계'),
    matrixPreview: getSheetPreview('CROSS_SELL_MATRIX', '상품 이동 전환 Matrix'),
    dailyPreview: getSheetPreview('DAILY_CONVERSION', '일자별 전환 흐름')
  };
}


function ping() {
  return {
    ok: true,
    message: 'pong',
    checkedAt: new Date().toISOString()
  };
}
