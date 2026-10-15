"""Small accounting examples; this is not a chain balance indexer or implementation.

Amounts here are whole USD to make the double-counting examples easy to inspect.
An actual implementation needs currency amounts, event identities and provenance.
"""


def examples():
    # Pledge fulfillment must atomically retire the fulfilled outstanding amount.
    ask, received, outstanding = 100, 40, 0
    converted_need = max(ask - received - outstanding, 0)
    naive_need = max(ask - received - 40, 0)
    assert (converted_need, naive_need) == (60, 20)

    # Cumulative-entitlement accounting: the round already committed 100, of which
    # 20 was delivered. Its own payment must not reduce the EXTERNAL support target.
    committed, delivered, raw_balance = 100, 20, 20
    external_balance = raw_balance - delivered
    correct_target = max(ask - external_balance, 0)
    wrong_target = max(ask - raw_balance, 0)
    assert (correct_target, wrong_target) == (100, 80)
    # Separately, remaining assets 80 back undelivered obligations 80.
    assert 100 - delivered == committed - delivered == 80

    # A raw balance cannot distinguish a legitimate expense from a withdrawal.
    initial_external_balance, final_external_balance = 40, 0
    initial_need = ask - initial_external_balance
    final_need = ask - final_external_balance
    assert (initial_need, final_need) == (60, 100)
    return {
        "units": "whole USD, illustrative ledger identities",
        "pledge_conversion": {"ask": ask, "received": received, "outstanding": outstanding,
                              "correct_need": converted_need, "naive_need": naive_need},
        "round_payment": {"ask": ask, "cumulative_entitlement": committed,
                          "delivered": delivered, "remaining_pool": 80,
                          "correct_total_grant_target": correct_target, "wrong_total_grant_target": wrong_target,
                          "undelivered_obligation": 80},
        "balance_spent_or_withdrawn": {"initial_need": initial_need, "final_need": final_need,
                                     "balance_only_cannot_identify_purpose": True}}


if __name__ == "__main__":
    import json
    print(json.dumps(examples(), indent=2, sort_keys=True))
