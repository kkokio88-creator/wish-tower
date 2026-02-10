/* === 2026 집반찬 소원탑 API 서버 === 
  이 코드는 Vercel 등 외부에서 요청을 받아
  구글 스프레드시트를 읽고 쓰는 역할을 합니다.
*/

// GET 요청 처리 (데이터 조회)
function doGet(e) {
  const op = e.parameter.op;
  
  // ?op=read 요청이 오면 전체 데이터 반환
  if (op === 'read') {
    return responseJSON(getWishes());
  }
  
  // 그 외 접속 시 상태 메시지
  return ContentService.createTextOutput("Wish Tower API is running...");
}

// POST 요청 처리 (쓰기, 수정, 삭제, 좋아요)
function doPost(e) {
  try {
    // Vercel에서 보낸 데이터 파싱
    const request = JSON.parse(e.postData.contents);
    const op = request.op;
    
    let result;
    
    if (op === 'create') {
      result = saveWish(request.data);       // 소원 등록
    } else if (op === 'update') {
      result = updateWish(request.data);     // 소원 수정
    } else if (op === 'delete') {
      result = deleteWish(request.id);       // 소원 삭제
    } else if (op === 'like') {
      result = addLike(request.id);          // 소원 좋아요
    } else if (op === 'comment') {
      result = saveComment(request.wishId, request.nick, request.content); // 댓글 등록
    } else if (op === 'comment_like') {
      result = addCommentLike(request.commentId); // 댓글 좋아요
    }
    
    return responseJSON({ status: 'success', result: result });
    
  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  }
}

// JSON 응답 생성 헬퍼 함수 (CORS 해결 핵심)
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==============================================
   아래는 구글 시트 직접 제어 함수들 (DB 로직)
   ============================================== */

// 1. 전체 소원 및 댓글 가져오기
function getWishes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Wishes 시트 확인 및 생성
  let wishSheet = ss.getSheetByName('Wishes');
  if (!wishSheet) {
    wishSheet = ss.insertSheet('Wishes');
    wishSheet.appendRow(['ID', 'Name', 'Dept', 'Wish', 'Skill', 'Likes', 'Date', 'Visible']);
    return [];
  }
  
  // 데이터 없으면 빈 배열
  if (wishSheet.getLastRow() <= 1) return [];

  // 소원 데이터 전체 로드
  const wishData = wishSheet.getDataRange().getValues();
  wishData.shift(); // 헤더 제거

  // Comments 시트 확인 및 생성
  let comments = [];
  const commentSheet = ss.getSheetByName('Comments');
  if (!commentSheet) {
    ss.insertSheet('Comments').appendRow(['WishID', 'Nickname', 'Content', 'Date', 'Likes', 'CommentID']);
  } else if (commentSheet.getLastRow() > 1) {
    const commentData = commentSheet.getDataRange().getValues();
    commentData.shift(); // 헤더 제거
    
    // 댓글 데이터 매핑
    comments = commentData.map(row => ({
      wishId: row[0],
      nickname: String(row[1]),
      content: String(row[2]),
      date: String(row[3]),
      likes: Number(row[4]) || 0,
      commentId: String(row[5])
    }));
  }

  // 데이터 조립 (소원 + 댓글 연결)
  return wishData.map(row => {
    // 빈 행 방어
    if (!row[0]) return null;

    const id = row[0];
    
    // 이 소원에 달린 댓글만 필터링 + 좋아요순 정렬
    const myComments = comments
      .filter(c => c.wishId == id)
      .sort((a, b) => b.likes - a.likes);
      
    // 삭제된 소원(Visible=FALSE) 체크
    const visibleVal = String(row[7]).toUpperCase().trim();
    const isVisible = (visibleVal !== 'FALSE'); 

    return {
      id: id, 
      name: String(row[1]), 
      dept: String(row[2]), 
      wish: String(row[3]), 
      skill: String(row[4]), 
      likes: Number(row[5]) || 0, 
      visible: isVisible, 
      comments: myComments, 
      totalComments: myComments.length
    };
  })
  .filter(item => item !== null && item.visible === true) // 삭제된 것 제외
  .sort((a, b) => b.likes - a.likes); // 소원 좋아요순 정렬
}

// 2. 소원 저장
function saveWish(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Wishes');
  if (!sheet) { sheet = ss.insertSheet('Wishes'); sheet.appendRow(['ID', 'Name', 'Dept', 'Wish', 'Skill', 'Likes', 'Date', 'Visible']); }
  
  // ID 자동 증가
  const lastRow = sheet.getLastRow();
  let lastId = 0;
  if (lastRow > 1) {
    lastId = sheet.getRange(lastRow, 1).getValue();
  }
  const newId = Number(lastId) + 1;
  
  // 저장
  sheet.appendRow([newId, d.name, d.dept, d.wish, d.skill, 0, new Date().toISOString(), true]);
  return newId;
}

// 3. 소원 수정
function updateWish(d) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Wishes');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == d.id) {
      sheet.getRange(i + 1, 4).setValue(d.wish);  // 내용 수정
      sheet.getRange(i + 1, 5).setValue(d.skill); // 노력 수정
      return true;
    }
  }
  return false;
}

// 4. 소원 삭제 (실제 삭제 안 하고 숨김 처리)
function deleteWish(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Wishes');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 8).setValue('FALSE'); // Visible = FALSE
      return true;
    }
  }
  return false;
}

// 5. 소원 좋아요 +1
function addLike(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Wishes');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      const cell = sheet.getRange(i + 1, 6);
      const val = Number(cell.getValue()) || 0;
      cell.setValue(val + 1);
      return true;
    }
  }
}

// 6. 댓글 저장
function saveComment(wid, nick, con) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Comments');
  if (!sheet) { sheet = ss.insertSheet('Comments'); sheet.appendRow(['WishID','Nickname','Content','Date','Likes','CommentID']); }
  
  const uniqueId = new Date().getTime().toString(); // 고유 ID 생성
  sheet.appendRow([wid, nick, con, new Date().toISOString(), 0, uniqueId]);
  return true;
}

// 7. 댓글 좋아요 +1
function addCommentLike(cid) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Comments');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    // 댓글 ID 비교 (문자열)
    if (String(data[i][5]) == String(cid)) {
      const cell = sheet.getRange(i + 1, 5);
      const val = Number(cell.getValue()) || 0;
      cell.setValue(val + 1);
      return true;
    }
  }
}