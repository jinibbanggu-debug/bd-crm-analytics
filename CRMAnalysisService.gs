function CRMAnalysisService(config) {
  this.config = config;
  this.sheets = config.SHEETS;
  this.headers = config.HEADERS;
  this.products = config.PRODUCT_HEADERS;
}

CRMAnalysisService.prototype.runAll = function () {
  this.buildDashboard();
  this.buildProductSummary();
  this.buildCrossSellMatrix();
  this.buildDailyConversionTrend();
};

CRMAnalysisService.prototype.getOrderDateRangeFromRecords_ = function () {
  var records = this.getRecords_();
  var earliest = null;
  var latest = null;

  for (var i = 0; i < records.length; i++) {
    var date = normalizeDateOnly_(records[i].orderDate);

    if (date) {
      earliest = date;
      break;
    }
  }

  for (var j = records.length - 1; j >= 0; j--) {
    var date2 = normalizeDateOnly_(records[j].orderDate);

    if (date2) {
      latest = date2;
      break;
    }
  }

  var startDate = earliest ? formatDate_(earliest) : '';
  var endDate = latest ? formatDate_(latest) : '';

  return {
    startDate: startDate,
    endDate: endDate,
    label: startDate && endDate ? startDate + ' ~ ' + endDate : '-'
  };
};

CRMAnalysisService.prototype.buildDashboard = function () {
  var records = this.getRecords_();
  var members = this.buildMembers_(records);

  var totalOrders = records.length;
  var totalMembers = Object.keys(members).length;
  var repurchaseMembers = 0;
  var crossSellMembers = 0;
  var totalAmount = 0;

  var self = this;

  Object.keys(members).forEach(function (memberId) {
    var member = members[memberId];

    if (self.products.some(function (product) {
      return member.rows.filter(function (row) {
        return row.products.indexOf(product) > -1;
      }).length >= 2;
    })) {
      repurchaseMembers++;
    }

    if (member.products.size >= 2) {
      crossSellMembers++;
    }

    totalAmount += member.totalAmount;
  });

  var values = [
    ['항목', '값'],
    ['총 주문건수', totalOrders],
    ['총 회원수', totalMembers],
    ['상품수', this.products.length],
    ['재구매 회원수', repurchaseMembers],
    ['추가구매 회원수', crossSellMembers],
    ['총 결제금액', totalAmount]
  ];

  writeSheet_(this.sheets.DASHBOARD, values);

  return values;
};

/**
 * 상품별 재구매 / 추가구매 / 이탈 통합 통계
 *
 * 상품을 산 고객을 아래 3가지 중 하나로 분류한다 (중복 집계 가능: 재구매와 추가구매는 동시에 해당될 수 있음).
 * - 재구매: 동일 상품을 2회 이상 구매 (시간 제한 없음)
 * - 추가구매: 기준 상품 외 다른 상품도 보유
 * - 이탈: 기준 상품을 1회만 구매하고, 다른 상품도 전혀 구매하지 않음 (재구매/추가구매 둘 다 없음)
 */
CRMAnalysisService.prototype.buildProductSummary = function () {
  var records = this.getRecords_();
  var members = this.buildMembers_(records);

  var rows = [
    ['상품', '구매고객수', '재구매고객수', '재구매횟수', '재구매율', '추가구매전환고객수', '추가구매상품수', '추가구매전환율', '이탈고객수', '이탈율']
  ];

  this.products.forEach(function (product) {
    var buyerCount = 0;
    var repurchaseBuyerCount = 0;
    var repurchaseEventCount = 0;
    var convertedCount = 0;
    var crossSellProductCount = 0;
    var churnCount = 0;

    Object.keys(members).forEach(function (memberId) {
      var member = members[memberId];

      var productRows = member.rows.filter(function (row) {
        return row.products.indexOf(product) > -1;
      });

      if (!productRows.length) {
        return;
      }

      buyerCount++;

      var repurchased = productRows.length >= 2;
      var crossSold = member.products.size >= 2;

      if (repurchased) {
        repurchaseBuyerCount++;
        repurchaseEventCount += productRows.length - 1;
      }

      if (crossSold) {
        convertedCount++;
        crossSellProductCount += member.products.size - 1;
      }

      if (!repurchased && !crossSold) {
        churnCount++;
      }
    });

    var repurchaseRate = buyerCount > 0 ? (repurchaseBuyerCount / buyerCount) * 100 : 0;
    var convertedRate = buyerCount > 0 ? (convertedCount / buyerCount) * 100 : 0;
    var churnRate = buyerCount > 0 ? (churnCount / buyerCount) * 100 : 0;

    rows.push([
      product,
      buyerCount,
      repurchaseBuyerCount,
      repurchaseEventCount,
      formatRate_(repurchaseRate),
      convertedCount,
      crossSellProductCount,
      formatRate_(convertedRate),
      churnCount,
      formatRate_(churnRate)
    ]);
  });

  var header = rows[0];

  var body = rows.slice(1).sort(function (a, b) {
    return toNumber_(b[1]) - toNumber_(a[1]);
  });

  rows = [header].concat(body);

  writeSheet_(this.sheets.PRODUCT_SUMMARY, rows);

  return rows;
};

/**
 * 일자별 재구매/추가구매/이탈 흐름
 *
 * 기준:
 * - 고객ID × 기준상품 최초구매일 기준
 * - 판정일 = 기준상품 최초구매일 + 상품별 판단기간
 * - 판단기간 내 동일상품 재구매 시 재구매
 * - 재구매 없이 다른 상품 구매 시 추가구매
 * - 둘 다 없으면 이탈
 * - 판단기간 미도래 건은 제외
 */
CRMAnalysisService.prototype.buildDailyConversionTrend = function (mode) {
  var selectedMode = String(mode || 'PURCHASE_DATE').toUpperCase();

  if (selectedMode === 'DUE_DATE') {
    return this.buildDailyConversionTrendByDueDate_();
  }

  return this.buildDailyConversionTrendByPurchaseDate_();
};

/**
 * 1. 구매일 기준
 *
 * 판정일 = 실제 주문일
 * 판정대상 = 해당일 구매 고객
 *
 * 고객 단위로 4가지 중 하나만 분류한다.
 * - 첫구매
 * - 재구매만
 * - 추가구매만
 * - 재구매+추가구매
 */
CRMAnalysisService.prototype.buildDailyConversionTrendByPurchaseDate_ = function () {
  var records = this.getRecords_();
  var recordsByDate = {};
  var historyByMember = {};
  var self = this;

  records.forEach(function (record) {
    var date = normalizeDateOnly_(record.orderDate);

    if (!date) {
      return;
    }

    var dateKey = formatDate_(date);

    if (!recordsByDate[dateKey]) {
      recordsByDate[dateKey] = [];
    }

    recordsByDate[dateKey].push(record);
  });

  var rows = [[
    '구매일',
    '구매고객수',
    '첫구매',
    '첫구매율',
    '재구매만',
    '재구매만율',
    '추가구매만',
    '추가구매만율',
    '재구매+추가구매',
    '재구매+추가구매율',
    '기존고객구매수',
    '기존고객구매율',
    '재구매포함수',
    '재구매포함율',
    '추가구매포함수',
    '추가구매포함율'
  ]];

  Object.keys(recordsByDate)
    .sort()
    .forEach(function (dateKey) {
      var dayRecords = recordsByDate[dateKey];
      var todayProductsByMember = {};

      dayRecords.forEach(function (record) {
        if (!todayProductsByMember[record.memberId]) {
          todayProductsByMember[record.memberId] = {};
        }

        record.products.forEach(function (product) {
          if (self.products.indexOf(product) > -1) {
            todayProductsByMember[record.memberId][product] = true;
          }
        });
      });

      var buyerCount = 0;
      var firstPurchase = 0;
      var repurchaseOnly = 0;
      var crossSellOnly = 0;
      var repurchaseAndCrossSell = 0;

      Object.keys(todayProductsByMember).forEach(function (memberId) {
        buyerCount++;

        var todayProducts = Object.keys(todayProductsByMember[memberId]);
        var pastProducts = historyByMember[memberId] || {};

        if (!Object.keys(pastProducts).length) {
          firstPurchase++;
          return;
        }

        var hasRepurchase = false;
        var hasCrossSell = false;

        todayProducts.forEach(function (product) {
          if (pastProducts[product]) {
            hasRepurchase = true;
          } else {
            hasCrossSell = true;
          }
        });

        if (hasRepurchase && hasCrossSell) {
          repurchaseAndCrossSell++;
        } else if (hasRepurchase) {
          repurchaseOnly++;
        } else if (hasCrossSell) {
          crossSellOnly++;
        }
      });

      // 같은 날짜 안의 여러 주문은 하나의 구매일 행동으로 보고,
      // 오늘 구매한 상품은 오늘 판정이 끝난 뒤 과거 이력으로 반영한다.
      Object.keys(todayProductsByMember).forEach(function (memberId) {
        if (!historyByMember[memberId]) {
          historyByMember[memberId] = {};
        }

        Object.keys(todayProductsByMember[memberId]).forEach(function (product) {
          historyByMember[memberId][product] = true;
        });
      });

      var existingBuyerCount = repurchaseOnly + crossSellOnly + repurchaseAndCrossSell;
      var repurchaseIncludedCount = repurchaseOnly + repurchaseAndCrossSell;
      var crossSellIncludedCount = crossSellOnly + repurchaseAndCrossSell;

      rows.push([
        dateKey,
        buyerCount,
        firstPurchase,
        formatRate_(buyerCount > 0 ? (firstPurchase / buyerCount) * 100 : 0),
        repurchaseOnly,
        formatRate_(buyerCount > 0 ? (repurchaseOnly / buyerCount) * 100 : 0),
        crossSellOnly,
        formatRate_(buyerCount > 0 ? (crossSellOnly / buyerCount) * 100 : 0),
        repurchaseAndCrossSell,
        formatRate_(buyerCount > 0 ? (repurchaseAndCrossSell / buyerCount) * 100 : 0),
        existingBuyerCount,
        formatRate_(buyerCount > 0 ? (existingBuyerCount / buyerCount) * 100 : 0),
        repurchaseIncludedCount,
        formatRate_(buyerCount > 0 ? (repurchaseIncludedCount / buyerCount) * 100 : 0),
        crossSellIncludedCount,
        formatRate_(buyerCount > 0 ? (crossSellIncludedCount / buyerCount) * 100 : 0)
      ]);
    });

  writeSheet_(this.sheets.DAILY_CONVERSION, rows);

  return rows;
};

/**
 * 2. 재구매 도래일 기준
 *
 * 판정일 = 기존 구매일 + 상품별 기준일수
 * 판정대상 = 해당일이 재구매 도래일인 고객/상품
 *
 * 결과:
 * - 재구매완료: 판정일까지 동일 상품을 다시 구매
 * - 추가구매만: 동일 상품은 재구매하지 않았지만 다른 상품 구매
 * - 미구매: 판정일까지 어떤 상품도 구매하지 않음
 * - 판정대기: 판정일이 현재 DB의 최신 주문일보다 미래라 아직 판단 불가
 */
CRMAnalysisService.prototype.buildDailyConversionTrendByDueDate_ = function () {
  var records = this.getRecords_();
  var members = this.buildMembers_(records);
  var latestOrderDate = records.length
    ? normalizeDateOnly_(records[records.length - 1].orderDate)
    : normalizeDateOnly_(new Date());

  var dailyMap = {};
  var self = this;

  records.forEach(function (baseRecord) {
    var baseDate = normalizeDateOnly_(baseRecord.orderDate);

    if (!baseDate || !baseRecord.products || !baseRecord.products.length) {
      return;
    }

    baseRecord.products.forEach(function (baseProduct) {
      if (self.products.indexOf(baseProduct) < 0) {
        return;
      }

      var decisionDays = self.getDecisionDays_(baseProduct, baseRecord);
      var decisionDate = addDays_(baseDate, decisionDays);

      if (!decisionDate) {
        return;
      }

      var dateKey = formatDate_(decisionDate);

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          targetCount: 0,
          completedTargetCount: 0,
          repurchaseCount: 0,
          crossSellCount: 0,
          churnCount: 0,
          pendingCount: 0
        };
      }

      dailyMap[dateKey].targetCount++;

      if (latestOrderDate && decisionDate.getTime() > latestOrderDate.getTime()) {
        dailyMap[dateKey].pendingCount++;
        return;
      }

      dailyMap[dateKey].completedTargetCount++;

      var status = self.classifyOutcome_(members[baseRecord.memberId].rows, baseRecord, baseProduct, decisionDate);

      if (status === '재구매') {
        dailyMap[dateKey].repurchaseCount++;
      } else if (status === '추가구매') {
        dailyMap[dateKey].crossSellCount++;
      } else {
        dailyMap[dateKey].churnCount++;
      }
    });
  });

  var rows = [[
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

  Object.keys(dailyMap)
    .sort()
    .forEach(function (dateKey) {
      var day = dailyMap[dateKey];
      var targetCount = day.targetCount || 0;
      var completedTargetCount = day.completedTargetCount || 0;

      rows.push([
        dateKey,
        targetCount,
        completedTargetCount,
        day.repurchaseCount,
        formatRate_(completedTargetCount > 0 ? (day.repurchaseCount / completedTargetCount) * 100 : 0),
        day.crossSellCount,
        formatRate_(completedTargetCount > 0 ? (day.crossSellCount / completedTargetCount) * 100 : 0),
        day.churnCount,
        formatRate_(completedTargetCount > 0 ? (day.churnCount / completedTargetCount) * 100 : 0),
        day.pendingCount,
        formatRate_(targetCount > 0 ? (day.pendingCount / targetCount) * 100 : 0)
      ]);
    });

  writeSheet_(this.sheets.DAILY_CONVERSION, rows);

  return rows;
};

CRMAnalysisService.prototype.getFirstRecordByProduct_ = function (rows) {
  var firstByProduct = {};
  var self = this;

  rows.forEach(function (record) {
    if (!record.products || !record.products.length) {
      return;
    }

    record.products.forEach(function (product) {
      if (self.products.indexOf(product) < 0) {
        return;
      }

      if (!firstByProduct[product]) {
        firstByProduct[product] = record;
      }
    });
  });

  return firstByProduct;
};

CRMAnalysisService.prototype.getDecisionDays_ = function (product, record) {
  var map = this.config.PRODUCT_DECISION_DAYS || {};
  var defaultDays = this.config.DEFAULT_DECISION_DAYS || 100;
  var text = '';

  if (record) {
    text = [
      record.productName,
      record.option
    ].map(function (value) {
      return String(value || '');
    }).join(' ');
  }

  var pouchMatch = text.match(/(\d+)\s*포/);
  var baseDays;

  if (pouchMatch && Number(pouchMatch[1]) > 0) {
    baseDays = Number(pouchMatch[1]);
  } else {
    baseDays = Number(map[product] || defaultDays);
  }

  var quantity = record && record.quantity > 0 ? record.quantity : 1;

  return baseDays * quantity;
};

CRMAnalysisService.prototype.classifyOutcome_ = function (rows, baseRecord, baseProduct, decisionDate) {
  var hasRepurchase = false;
  var hasCrossSell = false;
  var self = this;

  rows.forEach(function (record) {
    if (!self.isRecordAfterBase_(baseRecord, record)) {
      return;
    }

    var orderDate = normalizeDateOnly_(record.orderDate);

    if (!orderDate) {
      return;
    }

    if (orderDate.getTime() > decisionDate.getTime()) {
      return;
    }

    if (!record.products || !record.products.length) {
      return;
    }

    if (record.products.indexOf(baseProduct) > -1) {
      hasRepurchase = true;
    }

    record.products.forEach(function (product) {
      if (product !== baseProduct && self.products.indexOf(product) > -1) {
        hasCrossSell = true;
      }
    });
  });

  if (hasRepurchase) {
    return '재구매';
  }

  if (hasCrossSell) {
    return '추가구매';
  }

  return '이탈';
};

CRMAnalysisService.prototype.isRecordAfterBase_ = function (baseRecord, targetRecord) {
  if (!baseRecord || !targetRecord) {
    return false;
  }

  var baseDate = toDateValue_(baseRecord.orderDate);
  var targetDate = toDateValue_(targetRecord.orderDate);

  if (!baseDate || !targetDate) {
    return false;
  }

  var baseTime = baseDate.getTime();
  var targetTime = targetDate.getTime();

  if (targetTime > baseTime) {
    return true;
  }

  if (targetTime < baseTime) {
    return false;
  }

  var baseSequence = Number(baseRecord.sequence || 0);
  var targetSequence = Number(targetRecord.sequence || 0);

  if (baseSequence > 0 && targetSequence > 0 && targetSequence > baseSequence) {
    return true;
  }

  if (baseSequence === targetSequence && Number(targetRecord.rowNumber || 0) > Number(baseRecord.rowNumber || 0)) {
    return true;
  }

  return false;
};

/**
 * 상품 이동 전환 Matrix
 *
 * 기준:
 * - 10개 상품 전체를 기준상품으로 순회
 * - 고객별 기준상품 최초구매 이후에 발생한 다른 상품 구매만 추가구매 전환으로 집계
 * - 같은 고객이 같은 기준상품 > 추가구매상품 조합을 여러 번 구매해도 1건만 집계
 * - 구매 순서가 반대인 경우는 역방향으로 중복 집계하지 않음
 *   예: 레몬즙 구매 후 애사비 구매 → 레몬즙 > 애사비 1건, 애사비 > 레몬즙 0건
 */
CRMAnalysisService.prototype.buildCrossSellMatrix = function () {
  var records = this.getRecords_();
  var members = this.buildMembers_(records);
  var self = this;

  var baseBuyerMap = {};
  var transitionMap = {};

  this.products.forEach(function (baseProduct) {
    baseBuyerMap[baseProduct] = 0;
    transitionMap[baseProduct] = {};

    self.products.forEach(function (targetProduct) {
      if (targetProduct !== baseProduct) {
        transitionMap[baseProduct][targetProduct] = 0;
      }
    });
  });

  Object.keys(members).forEach(function (memberId) {
    var member = members[memberId];
    var firstByProduct = self.getFirstRecordByProduct_(member.rows);

    Object.keys(firstByProduct).forEach(function (baseProduct) {
      var baseRecord = firstByProduct[baseProduct];
      var convertedTargets = {};

      baseBuyerMap[baseProduct]++;

      member.rows.forEach(function (record) {
        if (!self.isRecordAfterBase_(baseRecord, record)) {
          return;
        }

        if (!record.products || !record.products.length) {
          return;
        }

        record.products.forEach(function (targetProduct) {
          if (targetProduct === baseProduct) {
            return;
          }

          if (self.products.indexOf(targetProduct) < 0) {
            return;
          }

          convertedTargets[targetProduct] = true;
        });
      });

      Object.keys(convertedTargets).forEach(function (targetProduct) {
        transitionMap[baseProduct][targetProduct]++;
      });
    });
  });

  var rows = [[
    '기준상품',
    '추가구매상품',
    '전환경로',
    '기준상품 구매고객수',
    '전환고객수',
    '전환율'
  ]];

  this.products.forEach(function (baseProduct) {
    self.products.forEach(function (targetProduct) {
      if (targetProduct === baseProduct) {
        return;
      }

      var baseBuyerCount = baseBuyerMap[baseProduct] || 0;
      var convertedCount = transitionMap[baseProduct][targetProduct] || 0;
      var conversionRate = baseBuyerCount > 0 ? (convertedCount / baseBuyerCount) * 100 : 0;

      rows.push([
        baseProduct,
        targetProduct,
        baseProduct + ' > ' + targetProduct,
        baseBuyerCount,
        convertedCount,
        formatRate_(conversionRate)
      ]);
    });
  });

  var header = rows[0];
  var body = rows.slice(1).sort(function (a, b) {
    var convertedDiff = toNumber_(b[4]) - toNumber_(a[4]);

    if (convertedDiff !== 0) {
      return convertedDiff;
    }

    var baseBuyerDiff = toNumber_(b[3]) - toNumber_(a[3]);

    if (baseBuyerDiff !== 0) {
      return baseBuyerDiff;
    }

    return String(a[2]).localeCompare(String(b[2]), 'ko');
  });

  rows = [header].concat(body);

  writeSheet_(this.sheets.CROSS_SELL_MATRIX, rows);

  return rows;
};

CRMAnalysisService.prototype.buildRepurchaseDetail = function (productName, minDays) {
  var members = this.buildMembers_(this.getRecords_());
  var productFilter = String(productName || '').trim();
  var minDaysNumber = minDays === '' || minDays === null || minDays === undefined ? 0 : Number(minDays);
  var self = this;

  var rows = [[
    '주문자ID',
    '상품',
    '상품별 구매횟수',
    '상품별 최초구매일',
    '상품별 최종구매일',
    '상품별 경과일',
    '전체 구매상품수',
    '구매상품목록',
    '총 결제금액'
  ]];

  Object.keys(members).forEach(function (memberId) {
    var member = members[memberId];
    var targetProducts = productFilter ? [productFilter] : self.products;

    targetProducts.forEach(function (product) {
      if (self.products.indexOf(product) < 0) return;

      var productRows = member.rows.filter(function (row) {
        return row.products.indexOf(product) > -1;
      });

      if (!productRows.length) return;

      var firstDate = productRows[0].orderDate;
      var lastDate = productRows[productRows.length - 1].orderDate;
      var elapsedDays = daysBetween_(lastDate, new Date());

      if (minDaysNumber && elapsedDays !== '' && Number(elapsedDays) < minDaysNumber) {
        return;
      }

      rows.push([
        memberId,
        product,
        productRows.length,
        formatDate_(firstDate),
        formatDate_(lastDate),
        elapsedDays,
        member.products.size,
        Array.from(member.products).join(', '),
        member.totalAmount
      ]);
    });
  });

  var header = rows[0];

  var body = rows.slice(1).sort(function (a, b) {
    return Number(b[5] || 0) - Number(a[5] || 0);
  });

  rows = [header].concat(body);

  writeSheet_(this.sheets.REPURCHASE_DETAIL, rows);

  return this.makeResult_(productFilter ? '재구매 대상자 - ' + productFilter : '재구매 대상자', rows);
};

CRMAnalysisService.prototype.buildCrossSellDetail = function (productName) {
  var members = this.buildMembers_(this.getRecords_());
  var productFilter = String(productName || '').trim();
  var targetBaseProducts = productFilter ? [productFilter] : this.products;
  var self = this;

  var rows = [[
    '주문자ID',
    '기준상품',
    '기준상품 최초구매일',
    '기준상품 최종구매일',
    '추가구매여부',
    '보유상품수',
    '구매상품목록',
    '추천상품',
    '총 결제금액'
  ]];

  var summaryItems = {};
  var summaryBaseBuyerCount = 0;
  var summaryConvertedCount = 0;

  Object.keys(members).forEach(function (memberId) {
    var member = members[memberId];

    targetBaseProducts.forEach(function (baseProduct) {
      if (self.products.indexOf(baseProduct) < 0) return;
      if (!member.products.has(baseProduct)) return;

      var baseRows = member.rows.filter(function (row) {
        return row.products.indexOf(baseProduct) > -1;
      });

      if (!baseRows.length) return;

      var otherProducts = Array.from(member.products).filter(function (product) {
        return product !== baseProduct;
      });

      var converted = otherProducts.length > 0;

      if (productFilter) {
        summaryBaseBuyerCount++;

        if (converted) {
          summaryConvertedCount++;

          otherProducts.forEach(function (product) {
            summaryItems[product] = (summaryItems[product] || 0) + 1;
          });
        }
      }

      rows.push([
        memberId,
        baseProduct,
        formatDate_(baseRows[0].orderDate),
        formatDate_(baseRows[baseRows.length - 1].orderDate),
        converted ? 'Y' : 'N',
        member.products.size,
        Array.from(member.products).join(', '),
        self.getRecommendedProducts_(member.products, baseProduct).join(', '),
        member.totalAmount
      ]);
    });
  });

  var header = rows[0];

  var body = rows.slice(1).sort(function (a, b) {
    if (a[4] === b[4]) {
      return Number(b[5] || 0) - Number(a[5] || 0);
    }

    return a[4] === 'N' ? -1 : 1;
  });

  rows = [header].concat(body);

  writeSheet_(this.sheets.CROSS_SELL_DETAIL, rows);

  var result = this.makeResult_(productFilter ? '추가구매 대상자 - ' + productFilter : '추가구매 대상자', rows);

  if (productFilter) {
    var nonConvertedCount = Math.max(summaryBaseBuyerCount - summaryConvertedCount, 0);
    var conversionRate = summaryBaseBuyerCount > 0 ? (summaryConvertedCount / summaryBaseBuyerCount) * 100 : 0;

    result.summary = {
      baseProduct: productFilter,
      baseBuyerCount: summaryBaseBuyerCount,
      convertedCount: summaryConvertedCount,
      conversionRate: formatRate_(conversionRate),
      nonConvertedCount: nonConvertedCount,
      items: Object.keys(summaryItems).map(function (product) {
        return {
          product: product,
          count: summaryItems[product]
        };
      }).sort(function (a, b) {
        return b.count - a.count;
      })
    };
  }

  return result;
};

CRMAnalysisService.prototype.searchCustomerSummaryById = function (customerId) {
  var id = String(customerId || '').trim();
  var member = this.buildSingleMember_(this.getRecordsForMember_(id));

  var rows = [[
    '주문자ID',
    '최초주문일',
    '최종주문일',
    '총주문건수',
    '구매상품수',
    '구매상품목록',
    '총 결제금액'
  ]];

  if (member) {
    rows.push([
      id,
      formatDate_(member.rows[0].orderDate),
      formatDate_(member.rows[member.rows.length - 1].orderDate),
      member.rows.length,
      member.products.size,
      Array.from(member.products).join(', '),
      member.totalAmount
    ]);
  }

  return this.makeResult_('고객별 구매 내역 - ' + id, rows);
};

CRMAnalysisService.prototype.searchCustomerProductById = function (customerId) {
  var id = String(customerId || '').trim();
  var member = this.buildSingleMember_(this.getRecordsForMember_(id));

  var rows = [[
    '주문자ID',
    '상품',
    '구매횟수',
    '최초구매일',
    '최종구매일',
    '경과일',
    '총 결제금액'
  ]];

  if (member) {
    this.products.forEach(function (product) {
      var productRows = member.rows.filter(function (row) {
        return row.products.indexOf(product) > -1;
      });

      if (!productRows.length) return;

      var totalAmount = productRows.reduce(function (sum, row) {
        return sum + row.amount;
      }, 0);

      rows.push([
        id,
        product,
        productRows.length,
        formatDate_(productRows[0].orderDate),
        formatDate_(productRows[productRows.length - 1].orderDate),
        daysBetween_(productRows[productRows.length - 1].orderDate, new Date()),
        totalAmount
      ]);
    });
  }

  return this.makeResult_('고객×상품 구매 내역 - ' + id, rows);
};

CRMAnalysisService.prototype.parseRecordRow_ = function (row, headerMap, rowNumber) {
  if (this.isEmptyRow_(row)) return null;

  var memberId = String(row[headerMap['주문자ID']] || '').trim();

  if (!memberId) return null;

  var products = this.getProductsFromRow_(row, headerMap);

  if (!products.length) return null;

  return {
    rowNumber: rowNumber,
    orderDate: row[headerMap['주문일']],
    memberId: memberId,
    productName: row[headerMap['상품명(한국어 쇼핑몰)']],
    option: row[headerMap['상품옵션']],
    quantity: toNumber_(row[headerMap['수량']]),
    sequence: toNumber_(row[headerMap['주문순번']]),
    amount: toNumber_(row[headerMap['총 결제금액']]),
    products: products,
    raw: row
  };
};

CRMAnalysisService.prototype.sortRecordsByDate_ = function (records) {
  records.sort(function (a, b) {
    var dateA = toDateValue_(a.orderDate);
    var dateB = toDateValue_(b.orderDate);
    var timeA = dateA ? dateA.getTime() : 0;
    var timeB = dateB ? dateB.getTime() : 0;

    if (timeA !== timeB) {
      return timeA - timeB;
    }

    if (a.sequence !== b.sequence) {
      return a.sequence - b.sequence;
    }

    return a.rowNumber - b.rowNumber;
  });

  return records;
};

CRMAnalysisService.prototype.getRecords_ = function () {
  if (this._recordsCache) {
    return this._recordsCache;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(this.sheets.DB);

  if (!sheet || sheet.getLastRow() <= 1) {
    this._recordsCache = [];
    return this._recordsCache;
  }

  var values = sheet.getDataRange().getValues();
  var header = values[0].map(String);
  var headerMap = {};

  header.forEach(function (name, index) {
    headerMap[name] = index;
  });

  var records = [];

  for (var r = 1; r < values.length; r++) {
    var record = this.parseRecordRow_(values[r], headerMap, r + 1);

    if (record) {
      records.push(record);
    }
  }

  this.sortRecordsByDate_(records);

  this._recordsCache = records;
  return records;
};

/**
 * 고객 1명의 주문만 필요한 경우, DB 전체를 읽지 않고
 * 주문자ID 컬럼만 먼저 읽어 해당 행만 골라 읽는다.
 */
CRMAnalysisService.prototype.getRecordsForMember_ = function (memberId) {
  if (this._recordsCache) {
    return this._recordsCache.filter(function (record) {
      return record.memberId === memberId;
    });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(this.sheets.DB);

  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  var headerMap = {};

  header.forEach(function (name, index) {
    headerMap[name] = index;
  });

  var idColumnIndex = headerMap['주문자ID'];

  if (idColumnIndex === undefined) {
    return [];
  }

  var idValues = sheet.getRange(2, idColumnIndex + 1, lastRow - 1, 1).getValues();
  var matchedRowNumbers = [];

  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0] || '').trim() === memberId) {
      matchedRowNumbers.push(i + 2);
    }
  }

  if (!matchedRowNumbers.length) {
    return [];
  }

  var self = this;
  var records = [];

  matchedRowNumbers.forEach(function (rowNumber) {
    var rowValues = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
    var record = self.parseRecordRow_(rowValues, headerMap, rowNumber);

    if (record) {
      records.push(record);
    }
  });

  this.sortRecordsByDate_(records);

  return records;
};

CRMAnalysisService.prototype.buildSingleMember_ = function (records) {
  if (!records.length) {
    return null;
  }

  var member = {
    rows: records,
    products: new Set(),
    totalAmount: 0
  };

  records.forEach(function (record) {
    member.totalAmount += record.amount;

    record.products.forEach(function (product) {
      member.products.add(product);
    });
  });

  return member;
};

CRMAnalysisService.prototype.buildMembers_ = function (records) {
  if (this._membersCache && this._membersCacheRecords === records) {
    return this._membersCache;
  }

  var members = {};

  records.forEach(function (record) {
    if (!members[record.memberId]) {
      members[record.memberId] = {
        memberId: record.memberId,
        rows: [],
        products: new Set(),
        totalAmount: 0
      };
    }

    var member = members[record.memberId];

    member.rows.push(record);
    member.totalAmount += record.amount;

    record.products.forEach(function (product) {
      member.products.add(product);
    });
  });

  Object.keys(members).forEach(function (memberId) {
    members[memberId].rows.sort(function (a, b) {
      var dateA = toDateValue_(a.orderDate);
      var dateB = toDateValue_(b.orderDate);
      var timeA = dateA ? dateA.getTime() : 0;
      var timeB = dateB ? dateB.getTime() : 0;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }

      return a.rowNumber - b.rowNumber;
    });
  });

  this._membersCache = members;
  this._membersCacheRecords = records;
  return members;
};

CRMAnalysisService.prototype.getProductsFromRow_ = function (row, headerMap) {
  var products = [];

  this.products.forEach(function (product) {
    var index = headerMap[product];

    if (index === undefined) return;

    var value = row[index];

    if (toNumber_(value) > 0) {
      products.push(product);
    }
  });

  return products;
};

CRMAnalysisService.prototype.getRecommendedProducts_ = function (ownedProducts, baseProduct) {
  return this.products.filter(function (product) {
    return product !== baseProduct && !ownedProducts.has(product);
  });
};

CRMAnalysisService.prototype.makeResult_ = function (title, values) {
  var total = Math.max(values.length - 1, 0);
  var limit = this.config.PREVIEW_LIMIT || 500;
  var shown = Math.min(total, limit);

  return {
    title: title,
    total: total,
    shown: shown,
    limit: limit,
    truncated: total > shown,
    rows: values.slice(0, shown + 1)
  };
};

CRMAnalysisService.prototype.isEmptyRow_ = function (row) {
  return row.every(function (value) {
    return value === '' || value === null || value === undefined;
  });
};